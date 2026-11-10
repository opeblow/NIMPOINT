import 'server-only';
import { asNetwork, bondMemo, bondOutMemo, type Network } from './config';
import { getBalance, normalizeAddress, recentTransactions, sameAddress } from './nimiq-rpc';
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
const key = (agentId: string) => `bond:${agentId}`;

/** NIM the agent has on deposit. `fresh` skips the short cache (used when an order depends on it). */
export async function bondNim(agentId: string, fresh = false): Promise<number> {
  const cfg = bondConfig();
  if (!cfg) return 0;
  const cached = await store.get<{ nim: number; at: number }>(key(agentId));
  if (!fresh && cached && Date.now() - cached.at < FRESH_MS) return cached.nim;
  try {
    const [txs, balance] = await Promise.all([recentTransactions(cfg.address, 500, cfg.network), getBalance(cfg.address, cfg.network)]);
    const memoIn = bondMemo(agentId);
    const memoOut = bondOutMemo(agentId);
    let net = 0;
    for (const t of txs) {
      const memo = t.memo.trim().toUpperCase();
      if (memo === memoIn && sameAddress(t.to, cfg.address)) net += t.nim;
      else if (memo === memoOut && sameAddress(t.from, cfg.address)) net -= t.nim;
    }
    const nim = Math.max(0, Math.min(net, balance));
    await store.set(key(agentId), { nim, at: Date.now() }, 3600);
    return nim;
  } catch (err) {
    // The chain is unreachable: a new order must not go ahead on a guess, a listing may show the last known value.
    if (fresh || !cached) throw err;
    return cached.nim;
  }
}
