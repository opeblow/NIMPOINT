import 'server-only';
import { asNetwork, bondMemo, bondOutMemo, type Network } from './config';
import { listAgents } from './agents';
import { getBalance, normalizeAddress, sameAddress, transactionHistory } from './nimiq-rpc';
import { store } from './store';

/**
 * Agent bonds. An agent sends NIM to one public bond wallet with the memo
 * NIMPOINT-BOND-<AGENT>. The bond is whatever the chain says: deposits with
 * that memo, minus anything paid back out with NIMPOINT-BONDOUT-<AGENT>, and
 * never more than the wallet really holds. Nothing here trusts our database.
 *
 * Bonds are off until BOND_ADDRESS is set.
 */
export function bondConfig(): { address: string; network: Network } | null {
  const raw = normalizeAddress(process.env.BOND_ADDRESS ?? '');
  if (!/^NQ[0-9]{2}[0-9A-Z]{32}$/.test(raw)) return null;
  return { address: raw.replace(/(.{4})(?=.)/g, '$1 '), network: asNetwork(process.env.BOND_NETWORK) };
}

const FRESH_MS = 15_000;
const BOOK_KEY = 'bond:book';
type Book = { nim: Record<string, number>; at: number };

/**
 * Every agent's bond, from the bond wallet's whole history. All agents share one wallet, so if
 * their deposits add up to more than it really holds (fees, a manual withdrawal), each bond is
 * scaled down by the same factor: together they can never promise more NIM than is there.
 */
async function readBook(): Promise<Book> {
  const cfg = bondConfig()!;
  const [txs, balance] = await Promise.all([
    transactionHistory(cfg.address, cfg.network, { max: 10_000, pageSize: 500 }),
    getBalance(cfg.address, cfg.network),
  ]);
  const ids = listAgents().map((a) => a.id);
  const byIn = new Map(ids.map((id) => [bondMemo(id), id]));
  const byOut = new Map(ids.map((id) => [bondOutMemo(id), id]));
  const net: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]));
  for (const t of txs) {
    const memo = t.memo.trim().toUpperCase();
    const inId = byIn.get(memo);
    const outId = byOut.get(memo);
    if (inId && sameAddress(t.to, cfg.address)) net[inId] += t.nim;
    else if (outId && sameAddress(t.from, cfg.address)) net[outId] -= t.nim;
  }
  for (const id of ids) net[id] = Math.max(0, net[id]);
  const total = ids.reduce((s, id) => s + net[id], 0);
  const scale = total > balance ? Math.max(0, balance) / total : 1;
  const nim = Object.fromEntries(ids.map((id) => [id, Math.floor(net[id] * scale * 1e5) / 1e5]));
  return { nim, at: Date.now() };
}

/** NIM the agent has on deposit. `fresh` skips the short cache (used when an order depends on it). */
export async function bondNim(agentId: string, fresh = false): Promise<number> {
  const cfg = bondConfig();
  if (!cfg) return 0;
  const cached = await store.get<Book>(BOOK_KEY);
  if (!fresh && cached && Date.now() - cached.at < FRESH_MS) return cached.nim[agentId] ?? 0;
  try {
    const book = await readBook();
    await store.set(BOOK_KEY, book, 3600);
    return book.nim[agentId] ?? 0;
  } catch (err) {
    // The chain is unreachable: a new order must not go ahead on a guess, a listing may show the last known value.
    if (fresh || !cached) throw err;
    return cached.nim[agentId] ?? 0;
  }
}
