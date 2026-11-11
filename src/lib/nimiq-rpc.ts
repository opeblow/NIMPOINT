import 'server-only';
import { LUNA_PER_NIM, type Network } from './config';

/** Minimal JSON-RPC client for Nimiq Albatross nodes, with failover across NIMIQ_RPC_URL entries. */
const rpcUrls = (net: Network) => {
  // Test network: on by default so test wallets get a working (clearly labelled) app. NIMIQ_TESTNET_RPC_URL=off disables it.
  const raw = net === 'testnet' ? process.env.NIMIQ_TESTNET_RPC_URL ?? 'https://rpc.testnet.nimiqwatch.com' : process.env.NIMIQ_RPC_URL ?? 'https://rpc.nimiqwatch.com';
  const urls = raw
    .split(',')
    .map((u) => u.trim())
    .filter((u) => /^https?:\/\//.test(u));
  if (net === 'testnet') return urls;
  // A test-network node set as the main node would make real payments invisible. Refuse it and fall back.
  const main = urls.filter((u) => !/testnet/i.test(u));
  if (main.length < urls.length) console.warn('[nimpoint] NIMIQ_RPC_URL points at a test-network node. Ignoring it for mainnet orders.');
  return main.length ? main : ['https://rpc.nimiqwatch.com'];
};

export const testnetEnabled = () => rpcUrls('testnet').length > 0;

export class RpcUnavailable extends Error {}

async function rpc<T>(method: string, params: unknown[], net: Network = 'mainnet'): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const { NIMIQ_RPC_USER: user, NIMIQ_RPC_PASSWORD: pass } = process.env;
  if (user && pass) headers.Authorization = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;

  const urls = rpcUrls(net);
  for (const url of [...urls, ...urls]) {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    }).catch(() => null);
    const json = res?.ok ? await res.json().catch(() => null) : null;
    if (!json) continue;
    if (json.error) throw new Error(`Nimiq RPC ${method}: ${json.error.message ?? 'error'}`);
    // Albatross wraps results as { data, metadata }.
    return (json.result?.data ?? json.result) as T;
  }
  throw new RpcUnavailable('Nimiq network is not reachable right now');
}

export const normalizeAddress = (a: string) => a.replace(/\s+/g, '').toUpperCase();
export const friendlyAddress = (a: string) => normalizeAddress(a).replace(/(.{4})(?=.)/g, '$1 ');
export const sameAddress = (a: string, b: string) => normalizeAddress(a) === normalizeAddress(b);

export function decodeData(hex?: string) {
  if (!hex) return '';
  try {
    return Buffer.from(hex.replace(/^0x/, ''), 'hex').toString('utf8');
  } catch {
    return '';
  }
}

export interface ChainTx {
  hash: string;
  from: string;
  to: string;
  nim: number;
  memo: string;
  timestamp: number;
  confirmations?: number;
}

interface RawTx {
  hash: string;
  from: string;
  to: string;
  value: number;
  recipientData?: string;
  senderData?: string;
  timestamp?: number;
  confirmations?: number;
  executionResult?: boolean;
}

const toChainTx = (t: RawTx): ChainTx => ({
  hash: t.hash,
  from: friendlyAddress(t.from),
  to: friendlyAddress(t.to),
  nim: Number(t.value ?? 0) / LUNA_PER_NIM,
  memo: decodeData(t.recipientData) || decodeData(t.senderData),
  timestamp: Number(t.timestamp ?? Date.now()),
  confirmations: t.confirmations,
});

/** A payment counts only once it is in a block (pending transactions can still vanish). */
const confirmed = (t: RawTx) => t.confirmations === undefined || t.confirmations >= 1;

export async function getTransaction(hash: string, net: Network = 'mainnet'): Promise<ChainTx | null> {
  const t = await rpc<RawTx | null>('getTransactionByHash', [hash], net).catch((e) => {
    if (e instanceof RpcUnavailable) throw e;
    return null;
  });
  return t && t.executionResult !== false && confirmed(t) ? toChainTx(t) : null;
}

/** Latest successful transactions touching an address, newest first. */
export async function recentTransactions(address: string, max = 100, net: Network = 'mainnet'): Promise<ChainTx[]> {
  const txs = await rpc<RawTx[]>('getTransactionsByAddress', [friendlyAddress(address), max, null], net);
  return (txs ?? []).filter((t) => t.executionResult !== false && confirmed(t)).map(toChainTx);
}

/**
 * Successful transactions touching an address, newest first, read page by page so a busy
 * address never pushes an order's payment (or a bond deposit) out of view.
 * Stops at `max` transactions, or once a page reaches transactions older than `since`.
 */
export async function transactionHistory(
  address: string,
  net: Network = 'mainnet',
  { since = 0, max = 2_000, pageSize = 100 }: { since?: number; max?: number; pageSize?: number } = {},
): Promise<ChainTx[]> {
  const out: ChainTx[] = [];
  const seen = new Set<string>();
  let startAt: string | null = null;
  while (out.length < max) {
    const page: RawTx[] = (await rpc<RawTx[]>('getTransactionsByAddress', [friendlyAddress(address), pageSize, startAt], net)) ?? [];
    let fresh = 0;
    let oldest = Infinity;
    for (const t of page) {
      if (seen.has(t.hash)) continue;
      seen.add(t.hash);
      fresh++;
      oldest = Math.min(oldest, Number(t.timestamp ?? Date.now()));
      if (t.executionResult !== false && confirmed(t)) out.push(toChainTx(t));
    }
    // A short page is the end of the history; a page with nothing new means the node ignored startAt.
    if (page.length < pageSize || !fresh || oldest < since) break;
    startAt = page[page.length - 1].hash;
  }
  return out.slice(0, max);
}

interface RawAccount {
  type: string;
  balance?: number;
  sender?: string;
}

/**
 * Nimiq Pay pays from an HTLC funded by the user's wallet. Resolve it back to
 * the wallet so we can tie a payment to a person.
 */
export async function ownerOf(address: string, net: Network = 'mainnet'): Promise<string> {
  const acc = await rpc<RawAccount | null>('getAccountByAddress', [friendlyAddress(address)], net).catch(() => null);
  if (acc?.type === 'htlc' && acc.sender) return friendlyAddress(acc.sender);
  return friendlyAddress(address);
}

/** NIM held at an address right now. */
export async function getBalance(address: string, net: Network = 'mainnet'): Promise<number> {
  const acc = await rpc<RawAccount | null>('getAccountByAddress', [friendlyAddress(address)], net);
  return Number(acc?.balance ?? 0) / LUNA_PER_NIM;
}

export const getBlockNumber = () => rpc<number>('getBlockNumber', []);
