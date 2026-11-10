import { listAgents } from '@/lib/agents';
import { MEMO_PREFIX } from '@/lib/config';
import { handle, ok } from '@/lib/http';
import { ownerOf, recentTransactions, sameAddress } from '@/lib/nimiq-rpc';
import { allOrders } from '@/lib/orders';
import { store } from '@/lib/store';
import type { Proof } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** Exactly the memo format NimPoint creates: prefix + 8-char order code. */
const MEMO_RE = new RegExp(`^${MEMO_PREFIX}-[2-9A-HJKMNP-Z]{8}$`);

const settled = new Set(['paid', 'payout_sent', 'completed', 'disputed']);

async function chainCount() {
  const agents = listAgents();
  const txs = (await Promise.all(agents.map((a) => recentTransactions(a.address, 500).catch(() => [])))).flat();
  const memoTxs = txs.filter((t) => MEMO_RE.test(t.memo.trim().toUpperCase()) && agents.some((a) => sameAddress(a.address, t.to)));
  const senders = [...new Set(memoTxs.map((t) => t.from))].slice(0, 200);
  const owners = await Promise.all(senders.map((s) => ownerOf(s).catch(() => s)));
  return {
    memoPayments: new Set(memoTxs.map((t) => t.hash)).size,
    uniqueSenders: new Set(owners).size,
    agents: agents.map((a) => ({ name: a.name, address: a.address })),
  };
}

export async function GET() {
  try {
    const cached = await store.get<Proof>('proof');
    if (cached && Date.now() - cached.generatedAt < 60_000) return ok(cached);

    const orders = (await allOrders()).filter((o) => o.tx && settled.has(o.status));
    const wallets = new Set(orders.map((o) => o.wallet));
    const ratings = orders.map((o) => o.rating).filter((r): r is number => !!r);

    const byDay = new Map<string, { orders: number; wallets: Set<string> }>();
    for (const o of orders) {
      const day = new Date(o.tx!.at).toISOString().slice(0, 10);
      const d = byDay.get(day) ?? { orders: 0, wallets: new Set() };
      d.orders++;
      d.wallets.add(o.wallet);
      byDay.set(day, d);
    }

    const proof: Proof = {
      generatedAt: Date.now(),
      ledger: {
        uniqueWallets: wallets.size,
        orders: orders.length,
        completed: orders.filter((o) => o.status === 'completed').length,
        volumeNgn: orders.reduce((s, o) => s + (o.payoutNgn ?? o.ngn), 0),
        volumeNim: orders.reduce((s, o) => s + (o.tx?.nim ?? 0), 0),
        ratingAvg: ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null,
        daily: [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, d]) => ({ day, orders: d.orders, wallets: d.wallets.size })),
        entries: orders.slice(0, 300).map((o) => ({
          id: o.id,
          kind: o.kind,
          mode: o.mode,
          wallet: o.wallet,
          ngn: o.payoutNgn ?? o.ngn,
          nim: o.tx!.nim,
          status: o.status,
          at: o.tx!.at,
          tx: o.tx!.hash,
          rating: o.rating,
        })),
      },
      chain: await chainCount().catch(() => ({ memoPayments: 0, uniqueSenders: 0, agents: [] })),
    };
    await store.set('proof', proof, 3600);
    return ok(proof);
  } catch (err) {
    return handle(err);
  }
}
