import { listAgents } from '@/lib/agents';
import { bondConfig } from '@/lib/bond';
import { asNetwork, MEMO_PREFIX, type Network } from '@/lib/config';
import { handle, ok } from '@/lib/http';
import { ownerOf, sameAddress, transactionHistory } from '@/lib/nimiq-rpc';
import { agentBond, allOrders, healNetwork, netOf } from '@/lib/orders';
import { store } from '@/lib/store';
import type { Proof } from '@/lib/types';
import { registeredCount } from '@/lib/users';

export const dynamic = 'force-dynamic';

/** Exactly the memo format NimPoint creates: prefix + 8-char order code. */
const MEMO_RE = new RegExp(`^${MEMO_PREFIX}-[2-9A-HJKMNP-Z]{8}$`);

const settled = new Set(['paid', 'payout_sent', 'completed', 'disputed']);

async function chainCount(net: Network) {
  const agents = listAgents();
  const txs = (await Promise.all(agents.map((a) => transactionHistory(a.address, net, { max: 5_000, pageSize: 500 }).catch(() => [])))).flat();
  const memoTxs = txs.filter((t) => MEMO_RE.test(t.memo.trim().toUpperCase()) && agents.some((a) => sameAddress(a.address, t.to)));
  const senders = [...new Set(memoTxs.map((t) => t.from))].slice(0, 200);
  const owners = await Promise.all(senders.map((s) => ownerOf(s, net).catch(() => s)));
  return {
    memoPayments: new Set(memoTxs.map((t) => t.hash)).size,
    uniqueSenders: new Set(owners).size,
    agents: agents.map((a) => ({ name: a.name, address: a.address })),
  };
}

async function bonds(net: Network): Promise<Proof['bonds']> {
  const cfg = bondConfig();
  if (!cfg || cfg.network !== net) return [];
  const all = await Promise.all(listAgents().map(async (a) => ({ a, b: await agentBond(a, net).catch(() => null) })));
  return all.flatMap(({ a, b }) => (b ? [{ agent: a.name, address: b.address, memo: b.memo, nim: b.nim, ngn: b.ngn }] : []));
}

/** Mainnet by default. `?network=testnet` shows test-network activity, which is never mixed into the real numbers. */
export async function GET(req: Request) {
  try {
    const net = asNetwork(new URL(req.url).searchParams.get('network'));
    const cacheKey = net === 'mainnet' ? 'proof' : `proof:${net}`;
    const cached = await store.get<Proof>(cacheKey);
    if (cached?.network === net && Date.now() - cached.generatedAt < 60_000) return ok(cached);

    const everything = await Promise.all((await allOrders()).filter((o) => o.tx && settled.has(o.status)).map(healNetwork));
    const orders = everything.filter((o) => netOf(o) === net);
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
      network: net,
      registeredUsers: await registeredCount(net),
      otherNetworkOrders: everything.length - orders.length,
      bonds: await bonds(net),
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
      chain: await chainCount(net).catch(() => ({ memoPayments: 0, uniqueSenders: 0, agents: [] })),
    };
    await store.set(cacheKey, proof, 3600);
    return ok(proof);
  } catch (err) {
    return handle(err);
  }
}
