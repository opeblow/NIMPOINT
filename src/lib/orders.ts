import 'server-only';
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
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

/** Someone else saved the order between our read and our write. */
class Conflict extends Error {}

const ID_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const newId = () => Array.from({ length: 8 }, () => ID_ALPHABET[randomInt(ID_ALPHABET.length)]).join('');

const K = {
  order: (id: string) => `order:${id}`,
  ver: (id: string) => `order:ver:${id}`,
  byWallet: (w: string) => `orders:wallet:${normalizeAddress(w)}`,
  byAgent: (a: string) => `orders:agent:${a}`,
  all: 'orders:all',
  tx: (h: string) => `tx:${h.toLowerCase()}`,
  idem: (w: string, key: string) => `idem:${normalizeAddress(w)}:${key}`,
  alert: (what: string) => `alert:${what}`,
  online: (a: string) => `agent:online:${a}`,
  stats: (a: string) => `agent:stats:${a}`,
};

const ORDER_TTL = 60 * 60 * 24 * 365;
const IDEM_TTL = 60 * 60 * 24;
const LATE_PAYMENT_WINDOW_MS = 24 * 3600 * 1000;
const SYNC_THROTTLE_MS = 4_000;
/** Paid orders are still watched for duplicate payments, just less often. */
const EXTRA_THROTTLE_MS = 60_000;
/** How long an agent's started NIM send blocks another send. */
export const SEND_LOCK_MS = 10 * 60_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const getOrder = (id: string) => store.get<Order>(K.order(id.toUpperCase()));

/** Save only if nobody saved this order since we read it. */
async function save(order: Order) {
  const v = order.v ?? 0;
  if (!(await store.casSet(K.order(order.id), K.ver(order.id), v, { ...order, v: v + 1 }, ORDER_TTL))) throw new Conflict();
  order.v = v + 1;
}

/**
 * Read, change, save, and start over if another request saved in between.
 * `change` gets a fresh copy each time; it returns false when there is nothing to save.
 */
async function update(id: string, change: (o: Order) => boolean | void | Promise<boolean | void>): Promise<Order> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const o = await getOrder(id);
    if (!o) throw new OrderError('Order not found.', 404);
    if ((await change(o)) === false) return o;
    try {
      await save(o);
      return o;
    } catch (err) {
      if (!(err instanceof Conflict)) throw err;
      await sleep(20 + Math.random() * 80);
    }
  }
  throw new OrderError('This order is busy. Please try again.', 409);
}

function transition(order: Order, status: OrderStatus, note?: string) {
  order.status = status;
  order.events.push({ status, at: Date.now(), note });
}

/** Each alert goes out at most once, however many requests notice the same thing. */
async function alertOnce(order: Order, what: string, send: (agent: Agent) => Promise<void>) {
  const agent = getAgent(order.agentId);
  if (!agent?.telegramChatId) return;
  if (!(await store.setNx(K.alert(what), '1', ORDER_TTL))) return;
  void send(agent);
}

/** Tell the agent about payment news on this order. Safe to call any number of times. */
async function notifyPayments(order: Order) {
  if (!order.tx) return;
  if (order.kind === 'cashout') await alertOnce(order, `paid:${order.id}`, (a) => alertAgent(a, order, 'paid'));
  for (const extra of order.extraPayments ?? []) {
    await alertOnce(order, `extra:${extra.hash.toLowerCase()}`, (a) => alertAgent(a, order, 'extra_payment', extra));
  }
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

const fingerprint = (parts: unknown[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 24);

/** A retry of a create we already handled: hand back the same order. */
async function replayCreate(key: string, fp: string): Promise<Order> {
  for (let i = 0; i < 12; i++) {
    const [prevFp, id] = String((await store.get<string>(key)) ?? '').split(':');
    if (!prevFp) break;
    if (prevFp !== fp) throw new OrderError('This request was already used for a different order. Please start again.', 422);
    if (id && id !== 'pending') {
      const order = await getOrder(id);
      if (order) return order;
      break;
    }
    await sleep(400);
  }
  throw new OrderError('Hang on, your order is being created.', 409);
}

export async function createOrder(input: {
  kind: OrderKind;
  mode: PayoutMode;
  agentId: string;
  wallet: string;
  ngn: number;
  bank?: BankAccount;
  /** Same key on a retry returns the same order instead of making a new one. */
  idempotencyKey?: string;
}): Promise<Order> {
  // Without a database, serverless instances would forget orders. Refuse rather than lose one.
  if (process.env.VERCEL && !persistent) throw new OrderError('NimPoint is being set up. Please try again in a few minutes.', 503);
  const agent = getAgent(input.agentId);
  if (!agent) throw new OrderError('That NimPoint is no longer available. Pick another one.');
  if (!supports(agent, input.kind, input.mode)) throw new OrderError(`${agent.name} doesn't offer this option.`);

  const fp = fingerprint([input.kind, input.mode, agent.id, normalizeAddress(input.wallet), Math.round(input.ngn), input.bank?.bankCode, input.bank?.accountNumber]);
  const idemKey = input.idempotencyKey ? K.idem(input.wallet, input.idempotencyKey) : null;
  // A retry is answered before any other check: the order already exists.
  if (idemKey && (await store.get<string>(idemKey))) return replayCreate(idemKey, fp);

  if (!(await isOnline(agent.id))) throw new OrderError(`${agent.name} is offline right now. Pick another NimPoint.`);
  const max = Math.min(LIMITS.maxNgn, agent.maxNgn);
  if (input.ngn < LIMITS.minNgn || input.ngn > max) {
    throw new OrderError(`Amount must be between ₦${LIMITS.minNgn.toLocaleString()} and ₦${max.toLocaleString()}.`);
  }
  if (input.kind === 'cashout' && input.mode === 'bank' && !input.bank) {
    throw new OrderError('Add the bank account to receive your Naira.');
  }
  if (sameAddress(input.wallet, agent.address)) throw new OrderError("You can't trade with your own NimPoint.");

  if (idemKey && !(await store.setNx(idemKey, `${fp}:pending`, IDEM_TTL))) return replayCreate(idemKey, fp);
  try {
    // One order every few seconds per wallet: a double-tap must not create two orders.
    if (!(await store.setNx(`rl:create:${normalizeAddress(input.wallet)}`, '1', 3))) {
      throw new OrderError('Hang on, your order is being created.', 429);
    }
    const quote = await getQuote();
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
      secret: randomBytes(24).toString('hex'),
    };
    transition(order, order.status);

    await save(order);
    await Promise.all([
      store.lpush(K.byWallet(order.wallet), id),
      store.lpush(K.byAgent(agent.id), id),
      store.lpush(K.all, id),
    ]);
    if (idemKey) await store.set(idemKey, `${fp}:${id}`, IDEM_TTL);
    if (input.kind === 'cashout' && input.mode === 'cash') void alertAgent(agent, order, 'created_cash');
    return order;
  } catch (err) {
    // Nothing was created, so the same key may try again.
    if (idemKey) await store.del(idemKey);
    throw err;
  }
}

/* ───────────────────────────── on-chain ───────────────────────────── */

/** Which status means "waiting for NIM to land on-chain". */
const awaitingNim = (o: Order) =>
  o.kind === 'cashout'
    ? o.status === 'awaiting_payment' || o.status === 'expired'
    : o.status === 'fiat_sent' || o.status === 'awaiting_fiat' || (o.status === 'disputed' && !o.tx);

const forOrder = (o: Order, t: ChainTx) => sameAddress(t.to, o.nimRecipient) && t.memo.trim().toUpperCase() === o.memo;
const toOnchain = (t: ChainTx) => ({ hash: t.hash, from: t.from, to: t.to, nim: t.nim, at: t.timestamp || Date.now() });

/** Mark the order paid by `tx`. Changes `order` in place; the caller saves it. */
async function applyPayment(order: Order, tx: ChainTx): Promise<boolean> {
  if (!forOrder(order, tx)) return false;
  // A transaction can settle exactly one order.
  const claimed = await store.setNx(K.tx(tx.hash), order.id, ORDER_TTL);
  // String(): Redis hands back an all-digit id as a number.
  if (!claimed && String(await store.get<string>(K.tx(tx.hash))) !== order.id) return false;

  order.tx = toOnchain(tx);
  // Short payment: the agent pays out what was actually received, at the locked rate.
  order.payoutNgn = order.kind === 'cashout' ? Math.min(order.ngn, Math.floor(tx.nim * order.rate)) : order.ngn;
  const short = order.kind === 'cashout' && order.payoutNgn < order.ngn;
  transition(order, 'paid', short ? `Received ${tx.nim} NIM (less than quoted)` : undefined);
  return true;
}

/** Any further payment with this memo is a duplicate that must be refunded. */
function recordExtras(order: Order, txs: ChainTx[]): boolean {
  if (!order.tx) return false;
  const known = new Set([order.tx.hash, ...(order.extraPayments ?? []).map((t) => t.hash)].map((h) => h.toLowerCase()));
  const fresh = txs.filter((t) => forOrder(order, t) && !known.has(t.hash.toLowerCase()));
  if (!fresh.length) return false;
  order.extraPayments = [...(order.extraPayments ?? []), ...fresh.map(toOnchain)];
  return true;
}

/**
 * Bring an order up to date with the chain. Safe to call often and from many
 * requests at once: throttled, version-checked, and it looks for the memo in
 * the recipient's history so a payment is found even if the app was closed
 * before it could report the hash. Paid orders keep being watched for
 * duplicate payments for 24 hours.
 */
export async function syncOrder(order: Order, force = false): Promise<Order> {
  const now = Date.now();
  if (now - order.createdAt > LATE_PAYMENT_WINDOW_MS) return order;
  const waiting = awaitingNim(order);
  if (!waiting && !order.tx) return order;
  const throttle = waiting ? SYNC_THROTTLE_MS : EXTRA_THROTTLE_MS;
  if (!force && order.lastSyncAt && now - order.lastSyncAt < throttle) return order;

  let txs: ChainTx[] | null = null;
  try {
    // Oldest first: the first payment settles the order, later ones are extras.
    txs = (await recentTransactions(order.nimRecipient, 50)).filter((t) => forOrder(order, t)).sort((a, b) => a.timestamp - b.timestamp);
  } catch (err) {
    console.warn('[sync]', order.id, (err as Error).message);
  }

  const next = await update(order.id, async (o) => {
    o.lastSyncAt = now;
    if (txs && awaitingNim(o)) {
      for (const t of txs) if (await applyPayment(o, t)) break;
    }
    if (txs) recordExtras(o, txs);
    if (o.status === 'awaiting_payment' && now > o.expiresAt) transition(o, 'expired');
  });
  await notifyPayments(next);
  return next;
}

/** Client reports the hash Nimiq Pay returned. We check it directly, then fall back to the memo scan. */
export async function reportTransaction(order: Order, hash: string): Promise<Order> {
  if (/^[0-9a-f]{64}$/i.test(hash)) {
    const tx = await getTransaction(hash).catch(() => null);
    if (tx && forOrder(order, tx)) {
      const next = await update(order.id, async (o) => {
        if (o.tx?.hash.toLowerCase() === tx.hash.toLowerCase()) return false;
        if (awaitingNim(o)) return applyPayment(o, tx);
        return recordExtras(o, [tx]);
      });
      if (next.tx) {
        await notifyPayments(next);
        return next;
      }
    }
  }
  return syncOrder(order, true);
}

/* ───────────────────────────── agent NIM send (top-up) ───────────────────────────── */

/**
 * Called right before the agent's Nimiq Pay opens. Checks the chain first and
 * takes a lock, so a second tap, a second phone or a lost "sent" flag can't
 * send the same NIM twice. `retry` reopens a stale lock after SEND_LOCK_MS.
 */
export async function startAgentSend(order: Order, agent: Agent, retry = false): Promise<Order> {
  if (order.agentId !== agent.id) throw new OrderError('Not your order.', 403);
  if (order.kind !== 'topup') throw new OrderError('Only top-ups need NIM from you.');
  const synced = await syncOrder(order, true);
  if (synced.tx) throw new OrderError('This order is already paid on-chain. Do not send again.', 409);
  return update(order.id, (o) => {
    if (o.tx || !awaitingNim(o)) throw new OrderError('This order is not waiting for NIM.', 409);
    if (o.sendStartedAt) {
      const age = Date.now() - o.sendStartedAt;
      if (!retry) throw new OrderError('You already started sending this. Check your Nimiq Pay history before sending again.', 409);
      if (age < SEND_LOCK_MS) {
        throw new OrderError(`Your last send may still land. Wait ${Math.ceil((SEND_LOCK_MS - age) / 60_000)} min, then check Nimiq Pay before sending again.`, 409);
      }
    }
    o.sendStartedAt = Date.now();
  });
}

/** Nimiq Pay said for certain nothing was sent (cancelled, low balance): release the lock. */
export async function cancelAgentSend(order: Order, agent: Agent): Promise<Order> {
  if (order.agentId !== agent.id) throw new OrderError('Not your order.', 403);
  return update(order.id, (o) => {
    if (o.tx || !o.sendStartedAt) return false;
    delete o.sendStartedAt;
  });
}

/* ───────────────────────────── people actions ───────────────────────────── */

export async function markFiatSent(order: Order) {
  const next = await update(order.id, (o) => {
    if (o.kind !== 'topup' || o.status !== 'awaiting_fiat') throw new OrderError('This order is not waiting for your payment.');
    transition(o, 'fiat_sent');
  });
  await alertOnce(next, `fiat_sent:${next.id}`, (a) => alertAgent(a, next, 'fiat_sent'));
  return next;
}

export async function markPayoutSent(order: Order, agent: Agent, ref?: string) {
  if (order.agentId !== agent.id) throw new OrderError('Not your order.', 403);
  return update(order.id, (o) => {
    if (o.kind !== 'cashout' || o.status !== 'paid') throw new OrderError('Only paid cash-outs can be marked as sent.');
    o.payoutRef = ref?.slice(0, 80);
    transition(o, 'payout_sent');
  });
}

export async function confirmReceived(
  order: Order,
  receipt?: { message: string; publicKey: string; signature: string },
) {
  const verified = receipt ? verifyNimiqMessage(receipt.message, receipt.publicKey, receipt.signature) : false;
  const next = await update(order.id, (o) => {
    const ok = o.kind === 'cashout' ? ['paid', 'payout_sent', 'disputed'] : ['paid', 'disputed'];
    if (!ok.includes(o.status)) throw new OrderError("This order can't be confirmed yet.");
    if (receipt) o.receipt = { ...receipt, verified };
    transition(o, 'completed');
  });
  await store.del(K.stats(next.agentId));
  return next;
}

export async function rateOrder(order: Order, stars: number, comment?: string) {
  const next = await update(order.id, (o) => {
    if (o.status !== 'completed') throw new OrderError('You can rate once the order is complete.');
    if (o.rating) throw new OrderError('Already rated. Thank you!');
    o.rating = Math.max(1, Math.min(5, Math.round(stars)));
    o.comment = comment?.slice(0, 280);
  });
  await store.del(K.stats(next.agentId));
  return next;
}

export async function disputeOrder(order: Order, note?: string) {
  const next = await update(order.id, (o) => {
    if (!['paid', 'payout_sent', 'fiat_sent'].includes(o.status)) throw new OrderError('Nothing to report on this order yet.');
    transition(o, 'disputed', note?.slice(0, 280));
  });
  await alertOnce(next, `disputed:${next.id}`, (a) => alertAgent(a, next, 'disputed'));
  return next;
}

/* ───────────────────────────── listings ───────────────────────────── */

async function loadMany(ids: string[]) {
  return ((await Promise.all(ids.map(getOrder))).filter(Boolean) as Order[]).sort((a, b) => b.createdAt - a.createdAt);
}

export const ordersForWallet = async (wallet: string, limit = 20) => loadMany(await store.lrange(K.byWallet(wallet), 0, limit - 1));
export const ordersForAgent = async (agentId: string, limit = 60) => loadMany(await store.lrange(K.byAgent(agentId), 0, limit - 1));
export const allOrders = async (limit = 1000) => loadMany(await store.lrange(K.all, 0, limit - 1));

/** What any browser (or the agent, with reveal) may see. The order secret never leaves the server after creation. */
export function publicOrder(o: Order, reveal = false): Order {
  const rest: Order = { ...o };
  delete rest.secret;
  if (reveal || !rest.bank) return rest;
  return { ...rest, bank: { ...rest.bank, accountNumber: `••••${rest.bank.accountNumber.slice(-4)}` } };
}

/** Only the order's creator holds its secret. Old orders made before secrets existed stay open. */
export function ownsOrder(o: Order, token: string | null) {
  if (!o.secret) return true;
  if (!token) return false;
  const a = createHash('sha256').update(o.secret).digest();
  const b = createHash('sha256').update(token).digest();
  return timingSafeEqual(a, b);
}
