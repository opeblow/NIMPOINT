import 'server-only';
import { randomInt } from 'node:crypto';
import { getAgent, listAgents, supports, type Agent } from './agents';
import { LIMITS, MEMO_PREFIX, QUOTE_TTL_MS } from './config';
import { getTransaction, normalizeAddress, recentTransactions, sameAddress, type ChainTx } from './nimiq-rpc';
import { agentRate, getQuote, nimFor } from './rates';
import { persistent, store } from './store';
import { alertAgent } from './telegram';
import type { AgentStats, BankAccount, Order, OrderKind, OrderStatus, PayoutMode, PublicAgent } from './types';
import { verifyNimiqMessage } from './signature';

export class OrderError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const ID_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const newId = () => Array.from({ length: 8 }, () => ID_ALPHABET[randomInt(ID_ALPHABET.length)]).join('');

const K = {
  order: (id: string) => `order:${id}`,
  byWallet: (w: string) => `orders:wallet:${normalizeAddress(w)}`,
  byAgent: (a: string) => `orders:agent:${a}`,
  all: 'orders:all',
  tx: (h: string) => `tx:${h.toLowerCase()}`,
  online: (a: string) => `agent:online:${a}`,
  stats: (a: string) => `agent:stats:${a}`,
};

const ORDER_TTL = 60 * 60 * 24 * 365;
const LATE_PAYMENT_WINDOW_MS = 24 * 3600 * 1000;
const SYNC_THROTTLE_MS = 4_000;

export const getOrder = (id: string) => store.get<Order>(K.order(id.toUpperCase()));

async function save(order: Order) {
  await store.set(K.order(order.id), order, ORDER_TTL);
}

function transition(order: Order, status: OrderStatus, note?: string) {
  order.status = status;
  order.events.push({ status, at: Date.now(), note });
}

/* ───────────────────────────── agents ───────────────────────────── */

export async function isOnline(agentId: string) {
  return (await store.get<string>(K.online(agentId))) !== '0';
}

export async function setOnline(agentId: string, online: boolean) {
  await store.set(K.online(agentId), online ? '1' : '0');
}

export async function agentStats(agentId: string): Promise<AgentStats> {
  const cached = await store.get<AgentStats & { at: number }>(K.stats(agentId));
  if (cached && Date.now() - cached.at < 60_000) return cached;

  const ids = await store.lrange(K.byAgent(agentId), 0, 300);
  const orders = (await Promise.all(ids.map(getOrder))).filter(Boolean) as Order[];
  const done = orders.filter((o) => o.status === 'completed');
  const ratings = done.map((o) => o.rating).filter((r): r is number => typeof r === 'number');
  const payoutMins = done
    .map((o) => {
      const paid = o.events.find((e) => e.status === 'paid')?.at;
      const out = o.events.find((e) => e.status === 'payout_sent' || e.status === 'completed')?.at;
      return paid && out ? (out - paid) / 60_000 : null;
    })
    .filter((m): m is number => m !== null)
    .sort((a, b) => a - b);

  const stats: AgentStats = {
    completed: done.length,
    ratingAvg: ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null,
    ratingCount: ratings.length,
    medianPayoutMins: payoutMins.length ? payoutMins[Math.floor(payoutMins.length / 2)] : null,
  };
  await store.set(K.stats(agentId), { ...stats, at: Date.now() }, 3600);
  return stats;
}

export async function publicAgent(a: Agent): Promise<PublicAgent> {
  const [online, stats] = await Promise.all([isOnline(a.id), agentStats(a.id)]);
  return {
    id: a.id,
    name: a.name,
    area: a.area,
    address: a.address,
    modes: a.modes,
    kinds: a.kinds,
    cashoutSpreadBps: a.cashoutSpreadBps,
    topupSpreadBps: a.topupSpreadBps,
    maxNgn: a.maxNgn,
    telegram: a.telegram,
    online,
    stats,
  };
}

export const publicAgents = () => Promise.all(listAgents().map(publicAgent));

/* ───────────────────────────── create ───────────────────────────── */

export async function createOrder(input: {
  kind: OrderKind;
  mode: PayoutMode;
  agentId: string;
  wallet: string;
  ngn: number;
  bank?: BankAccount;
}): Promise<Order> {
  // Without a database, serverless instances would forget orders. Refuse rather than lose one.
  if (process.env.VERCEL && !persistent) throw new OrderError('NimPoint is being set up. Please try again in a few minutes.', 503);
  const agent = getAgent(input.agentId);
  if (!agent) throw new OrderError('That NimPoint is no longer available. Pick another one.');
  if (!supports(agent, input.kind, input.mode)) throw new OrderError(`${agent.name} doesn't offer this option.`);
  if (!(await isOnline(agent.id))) throw new OrderError(`${agent.name} is offline right now. Pick another NimPoint.`);

  const max = Math.min(LIMITS.maxNgn, agent.maxNgn);
  if (input.ngn < LIMITS.minNgn || input.ngn > max) {
    throw new OrderError(`Amount must be between ₦${LIMITS.minNgn.toLocaleString()} and ₦${max.toLocaleString()}.`);
  }
  if (input.kind === 'cashout' && input.mode === 'bank' && !input.bank) {
    throw new OrderError('Add the bank account to receive your Naira.');
  }
  if (sameAddress(input.wallet, agent.address)) throw new OrderError("You can't trade with your own NimPoint.");

  const quote = await getQuote();
  // One order every few seconds per wallet: a double-tap must not create two orders.
  if (!(await store.setNx(`rl:create:${normalizeAddress(input.wallet)}`, '1', 3))) {
    throw new OrderError('Hang on, your order is being created.', 429);
  }
  const spread = input.kind === 'cashout' ? agent.cashoutSpreadBps : agent.topupSpreadBps;
  const rate = agentRate(quote.mid, input.kind, spread);
  const now = Date.now();
  const id = newId();

  const order: Order = {
    id,
    kind: input.kind,
    mode: input.mode,
    agentId: agent.id,
    wallet: input.wallet.replace(/\s+/g, '').replace(/(.{4})(?=.)/g, '$1 ').toUpperCase(),
    ngn: Math.round(input.ngn),
    nim: nimFor(input.ngn, rate, input.kind),
    rate,
    memo: `${MEMO_PREFIX}-${id}`,
    nimRecipient: input.kind === 'cashout' ? agent.address : input.wallet,
    bank: input.kind === 'cashout' && input.mode === 'bank' ? input.bank : undefined,
    status: input.kind === 'cashout' ? 'awaiting_payment' : 'awaiting_fiat',
    createdAt: now,
    expiresAt: now + QUOTE_TTL_MS,
    events: [],
  };
  transition(order, order.status);

  await save(order);
  await Promise.all([
    store.lpush(K.byWallet(order.wallet), id),
    store.lpush(K.byAgent(agent.id), id),
    store.lpush(K.all, id),
  ]);
  if (input.kind === 'cashout' && input.mode === 'cash') void alertAgent(agent, order, 'created_cash');
  return order;
}

/* ───────────────────────────── on-chain ───────────────────────────── */

/** Which status means "waiting for NIM to land on-chain". */
const awaitingNim = (o: Order) =>
  o.kind === 'cashout' ? o.status === 'awaiting_payment' || o.status === 'expired' : o.status === 'fiat_sent' || o.status === 'awaiting_fiat';

async function applyPayment(order: Order, tx: ChainTx): Promise<boolean> {
  if (!sameAddress(tx.to, order.nimRecipient)) return false;
  if (tx.memo.trim().toUpperCase() !== order.memo) return false;
  // A transaction can settle exactly one order.
  const claimed = await store.setNx(K.tx(tx.hash), order.id, ORDER_TTL);
  if (!claimed && (await store.get<string>(K.tx(tx.hash))) !== order.id) return false;

  order.tx = { hash: tx.hash, from: tx.from, to: tx.to, nim: tx.nim, at: tx.timestamp || Date.now() };
  // Short payment: the agent pays out what was actually received, at the locked rate.
  order.payoutNgn = order.kind === 'cashout' ? Math.min(order.ngn, Math.floor(tx.nim * order.rate)) : order.ngn;
  const short = order.kind === 'cashout' && order.payoutNgn < order.ngn;
  transition(order, 'paid', short ? `Received ${tx.nim} NIM (less than quoted)` : undefined);
  await save(order);

  const agent = getAgent(order.agentId);
  if (agent && order.kind === 'cashout') void alertAgent(agent, order, 'paid');
  return true;
}

/**
 * Bring an order up to date with the chain. Safe to call often: throttled,
 * and it looks for the memo in the recipient's history so a payment is found
 * even if the app was closed before it could report the hash.
 */
export async function syncOrder(order: Order, force = false): Promise<Order> {
  const now = Date.now();
  if (!awaitingNim(order)) return order;
  if (now - order.createdAt > LATE_PAYMENT_WINDOW_MS) return order;
  if (!force && order.lastSyncAt && now - order.lastSyncAt < SYNC_THROTTLE_MS) return order;

  order.lastSyncAt = now;
  try {
    const txs = await recentTransactions(order.nimRecipient, 50);
    const match = txs.find((t) => t.memo.trim().toUpperCase() === order.memo && sameAddress(t.to, order.nimRecipient));
    if (match && (await applyPayment(order, match))) return order;
  } catch (err) {
    console.warn('[sync]', order.id, (err as Error).message);
  }

  if (order.status === 'awaiting_payment' && now > order.expiresAt) transition(order, 'expired');
  await save(order);
  return order;
}

/** Client reports the hash Nimiq Pay returned. We check it directly, then fall back to the memo scan. */
export async function reportTransaction(order: Order, hash: string): Promise<Order> {
  if (/^[0-9a-f]{64}$/i.test(hash)) {
    const tx = await getTransaction(hash).catch(() => null);
    if (tx && awaitingNim(order) && (await applyPayment(order, tx))) return order;
  }
  return syncOrder(order, true);
}

/* ───────────────────────────── people actions ───────────────────────────── */

export async function markFiatSent(order: Order) {
  if (order.kind !== 'topup' || order.status !== 'awaiting_fiat') throw new OrderError('This order is not waiting for your payment.');
  transition(order, 'fiat_sent');
  await save(order);
  const agent = getAgent(order.agentId);
  if (agent) void alertAgent(agent, order, 'fiat_sent');
  return order;
}

export async function markPayoutSent(order: Order, agent: Agent, ref?: string) {
  if (order.agentId !== agent.id) throw new OrderError('Not your order.', 403);
  if (order.kind !== 'cashout' || order.status !== 'paid') throw new OrderError('Only paid cash-outs can be marked as sent.');
  order.payoutRef = ref?.slice(0, 80);
  transition(order, 'payout_sent');
  await save(order);
  return order;
}

export async function confirmReceived(
  order: Order,
  receipt?: { message: string; publicKey: string; signature: string },
) {
  const ok = order.kind === 'cashout' ? ['paid', 'payout_sent', 'disputed'] : ['paid', 'disputed'];
  if (!ok.includes(order.status)) throw new OrderError("This order can't be confirmed yet.");
  if (receipt) {
    order.receipt = { ...receipt, verified: verifyNimiqMessage(receipt.message, receipt.publicKey, receipt.signature) };
  }
  transition(order, 'completed');
  await save(order);
  await store.del(K.stats(order.agentId));
  return order;
}

export async function rateOrder(order: Order, stars: number, comment?: string) {
  if (order.status !== 'completed') throw new OrderError('You can rate once the order is complete.');
  if (order.rating) throw new OrderError('Already rated. Thank you!');
  order.rating = Math.max(1, Math.min(5, Math.round(stars)));
  order.comment = comment?.slice(0, 280);
  await save(order);
  await store.del(K.stats(order.agentId));
  return order;
}

export async function disputeOrder(order: Order, note?: string) {
  if (!['paid', 'payout_sent', 'fiat_sent'].includes(order.status)) throw new OrderError('Nothing to report on this order yet.');
  transition(order, 'disputed', note?.slice(0, 280));
  await save(order);
  const agent = getAgent(order.agentId);
  if (agent) void alertAgent(agent, order, 'disputed');
  return order;
}

/* ───────────────────────────── listings ───────────────────────────── */

async function loadMany(ids: string[]) {
  return ((await Promise.all(ids.map(getOrder))).filter(Boolean) as Order[]).sort((a, b) => b.createdAt - a.createdAt);
}

export const ordersForWallet = async (wallet: string, limit = 20) => loadMany(await store.lrange(K.byWallet(wallet), 0, limit - 1));
export const ordersForAgent = async (agentId: string, limit = 60) => loadMany(await store.lrange(K.byAgent(agentId), 0, limit - 1));
export const allOrders = async (limit = 1000) => loadMany(await store.lrange(K.all, 0, limit - 1));

/** What any browser may see. Bank account numbers are masked. */
export function publicOrder(o: Order, reveal = false): Order {
  if (reveal || !o.bank) return o;
  return { ...o, bank: { ...o.bank, accountNumber: `••••${o.bank.accountNumber.slice(-4)}` } };
}
