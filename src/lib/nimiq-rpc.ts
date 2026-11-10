import 'server-only';
import { LUNA_PER_NIM } from './config';

/** Minimal JSON-RPC client for Nimiq Albatross nodes, with failover across NIMIQ_RPC_URL entries. */
const rpcUrls = () =>
  (process.env.NIMIQ_RPC_URL ?? 'https://rpc.nimiqwatch.com')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);

export class RpcUnavailable extends Error {}

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const { NIMIQ_RPC_USER: user, NIMIQ_RPC_PASSWORD: pass } = process.env;
  if (user && pass) headers.Authorization = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;

  const urls = rpcUrls();
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

export async function getTransaction(hash: string): Promise<ChainTx | null> {
  const t = await rpc<RawTx | null>('getTransactionByHash', [hash]).catch((e) => {
    if (e instanceof RpcUnavailable) throw e;
    return null;
  });
  return t && t.executionResult !== false ? toChainTx(t) : null;
}

/** Latest successful transactions touching an address, newest first. */
export async function recentTransactions(address: string, max = 100): Promise<ChainTx[]> {
  const txs = await rpc<RawTx[]>('getTransactionsByAddress', [friendlyAddress(address), max, null]);
  return (txs ?? []).filter((t) => t.executionResult !== false).map(toChainTx);
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
export async function ownerOf(address: string): Promise<string> {
  const acc = await rpc<RawAccount | null>('getAccountByAddress', [friendlyAddress(address)]).catch(() => null);
  if (acc?.type === 'htlc' && acc.sender) return friendlyAddress(acc.sender);
  return friendlyAddress(address);
}

export const getBlockNumber = () => rpc<number>('getBlockNumber', []);
