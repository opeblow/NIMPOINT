import 'server-only';
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { getAgent, listAgents, supports, type Agent } from './agents';
import { bondConfig, bondNim } from './bond';
import { bondMemo, bondOutMemo, LIMITS, MEMO_PREFIX, QUOTE_TTL_MS, type Network } from './config';
import { ngn as fmtNgn } from './format';
import { getTransaction, normalizeAddress, ownerOf, sameAddress, testnetEnabled, transactionHistory, type ChainTx } from './nimiq-rpc';
import { agentRate, getQuote, nimFor } from './rates';
import { persistent, store } from './store';
import { alertAgent } from './telegram';
import type { AgentStats, BankAccount, Bond, Order, OrderKind, OrderStatus, PayoutMode, PublicAgent } from './types';
import { addressFromPublicKey, verifyNimiqMessage } from './signature';

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
/** The order ID is public (it is in the on-chain memo), so cash pickup needs its own secret code. */
const newPickupCode = () => String(randomInt(1_000_000)).padStart(6, '0');
const needsPickupCode = (o: Pick<Order, 'kind' | 'mode'>) => o.kind === 'cashout' && o.mode === 'cash';

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
  stats: (a: string, net: Network = 'mainnet') => (net === 'mainnet' ? `agent:stats:${a}` : `agent:stats:${net}:${a}`),
};

const ORDER_TTL = 60 * 60 * 24 * 365;
const IDEM_TTL = 60 * 60 * 24;
const LATE_PAYMENT_WINDOW_MS = 24 * 3600 * 1000;
const SYNC_THROTTLE_MS = 4_000;
/** Paid orders are still watched for duplicate payments, just less often. */
const EXTRA_THROTTLE_MS = 60_000;
/**
 * A finished-looking order closes by itself after this long if the customer neither confirms nor reports a problem,
 * so a silent customer can't hold an honest agent's record (or bond) hostage.
 */
const AUTO_COMPLETE_MS = Number(process.env.AUTO_COMPLETE_MS) || 24 * 3600 * 1000;
/** How long an agent's started NIM send blocks another send. */
export const SEND_LOCK_MS = 10 * 60_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const getOrder = (id: string) => store.get<Order>(K.order(id.toUpperCase()));

/** Orders made before networks were recorded were all mainnet. */
export const netOf = (o: Pick<Order, 'network'>): Network => o.network ?? 'mainnet';

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

const agentOrders = async (agentId: string, net: Network) =>
  ((await Promise.all((await store.lrange(K.byAgent(agentId), 0, 300)).map(getOrder))).filter(Boolean) as Order[]).filter((o) => netOf(o) === net);

export async function agentStats(agentId: string, net: Network = 'mainnet'): Promise<AgentStats> {
  const cached = await store.get<AgentStats & { at: number }>(K.stats(agentId, net));
  if (cached && Date.now() - cached.at < 60_000) return cached;

  const orders = await agentOrders(agentId, net);
  // An order NimPoint had to refund from the bond is not a job well done.
  const done = orders.filter((o) => o.status === 'completed' && o.resolution !== 'refunded');
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
  await store.set(K.stats(agentId, net), { ...stats, at: Date.now() }, 3600);
  return stats;
}

/* ───────────────────────────── bond ───────────────────────────── */

/** A cash-out the agent has been paid for on-chain but has not finished paying out. */
const owesNaira = (o: Order) => o.kind === 'cashout' && Boolean(o.tx) && ['paid', 'payout_sent', 'disputed'].includes(o.status);

/**
 * The agent's bond and how much of it is free. Null when bonds are off or kept on the other network.
 * Only cash-outs count against it: there the chain proves the agent holds the customer's NIM.
 */
export async function agentBond(agent: Agent, net: Network, fresh = false): Promise<Bond | null> {
  const cfg = bondConfig();
  if (!cfg || cfg.network !== net) return null;
  const [nim, quote, orders] = await Promise.all([bondNim(agent.id, fresh), getQuote(), agentOrders(agent.id, net)]);
  const open = await Promise.all(orders.filter(owesNaira).map(autoComplete));
  const exposureNgn = open.filter(owesNaira).reduce((s, o) => s + (o.payoutNgn ?? o.ngn), 0);
  const ngn = Math.floor(nim * quote.mid);
  return { address: cfg.address, memo: bondMemo(agent.id), network: net, nim, ngn, exposureNgn, availableNgn: Math.max(0, ngn - exposureNgn) };
}

export async function publicAgent(a: Agent, net: Network = 'mainnet'): Promise<PublicAgent> {
  const [online, stats, bond] = await Promise.all([
    isOnline(a.id),
    agentStats(a.id, net),
    // If the chain can't be read, show the bond as empty rather than hide the agent or guess.
    agentBond(a, net).catch(() => {
      const cfg = bondConfig();
      return cfg && cfg.network === net ? { address: cfg.address, memo: bondMemo(a.id), network: net, nim: 0, ngn: 0, exposureNgn: 0, availableNgn: 0 } : null;
    }),
  ]);
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
    bond,
  };
}

export const publicAgents = (net: Network = 'mainnet') => Promise.all(listAgents().map((a) => publicAgent(a, net)));

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
  network?: Network;
  /** Same key on a retry returns the same order instead of making a new one. */
  idempotencyKey?: string;
}): Promise<Order> {
  // Without a database, serverless instances would forget orders. Refuse rather than lose one.
  if (process.env.VERCEL && !persistent) throw new OrderError('NimPoint is being set up. Please try again in a few minutes.', 503);
  const agent = getAgent(input.agentId);
  if (!agent) throw new OrderError('That NimPoint is no longer available. Pick another one.');
  if (!supports(agent, input.kind, input.mode)) throw new OrderError(`${agent.name} doesn't offer this option.`);

  const net = input.network ?? 'mainnet';
  const fp = fingerprint([input.kind, input.mode, agent.id, normalizeAddress(input.wallet), Math.round(input.ngn), input.bank?.bankCode, input.bank?.accountNumber, net]);
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
  if (net === 'testnet' && !testnetEnabled()) throw new OrderError('Your Nimiq Pay is on the test network. Switch it to mainnet to use NimPoint.');
  // Read the bond straight from the chain: an order must never rest on a stale number.
  const bond = await agentBond(agent, net, true);
  if (bond) {
    if (bond.nim <= 0) throw new OrderError(`${agent.name} has not posted a bond yet, so it can't take orders. Pick another NimPoint.`);
    if (input.kind === 'cashout' && input.ngn > bond.availableNgn) {
      throw new OrderError(
        bond.availableNgn >= LIMITS.minNgn
          ? `${agent.name} can take up to ${fmtNgn(bond.availableNgn)} right now. Try a smaller amount or another NimPoint.`
          : `${agent.name}'s bond is fully in use right now. Try again shortly or pick another NimPoint.`,
      );
    }
  }

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
      pickupCode: needsPickupCode(input) ? newPickupCode() : undefined,
      network: net,
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
  return autoComplete(await chainSync(order, force));
}

const autoCompleteDue = (o: Order) => {
  const last = o.kind === 'cashout' ? 'payout_sent' : 'paid';
  if (o.status !== last) return false;
  const at = [...o.events].reverse().find((e) => e.status === last)?.at;
  return Boolean(at) && Date.now() - at! >= AUTO_COMPLETE_MS;
};

/**
 * Close an order nobody confirmed. Cash-out: the agent marked the Naira sent and the customer
 * reported no problem in time. Top-up: the NIM is verified on-chain in the customer's wallet.
 */
export async function autoComplete(order: Order): Promise<Order> {
  if (!autoCompleteDue(order)) return order;
  const next = await update(order.id, (o) => {
    if (!autoCompleteDue(o)) return false;
    o.autoCompleted = true;
    transition(o, 'completed', 'Completed automatically: no problem was reported');
  });
  await store.del(K.stats(next.agentId, netOf(next)));
  return next;
}

async function chainSync(order: Order, force: boolean): Promise<Order> {
  const now = Date.now();
  if (now - order.createdAt > LATE_PAYMENT_WINDOW_MS) return order;
  const waiting = awaitingNim(order);
  if (!waiting && !order.tx) return order;
  const throttle = waiting ? SYNC_THROTTLE_MS : EXTRA_THROTTLE_MS;
  if (!force && order.lastSyncAt && now - order.lastSyncAt < throttle) return order;

  let txs: ChainTx[] | null = null;
  try {
    // Oldest first: the first payment settles the order, later ones are extras.
    // Everything since the order was made (a minute of slack for clock skew), however busy the address is.
    txs = (await transactionHistory(order.nimRecipient, netOf(order), { since: order.createdAt - 60_000 }))
      .filter((t) => forOrder(order, t))
      .sort((a, b) => a.timestamp - b.timestamp);
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
    const tx = await getTransaction(hash, netOf(order)).catch(() => null);
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

/** True when this cash pickup can only be released with the customer's code. Old orders made before codes existed are exempt. */
export const pickupCodeRequired = (o: Order) => needsPickupCode(o) && Boolean(o.pickupCode);

const sameCode = (a: string, b: string) => {
  const x = createHash('sha256').update(a).digest();
  const y = createHash('sha256').update(b).digest();
  return timingSafeEqual(x, y);
};

export async function markPayoutSent(order: Order, agent: Agent, ref?: string, code?: string) {
  if (order.agentId !== agent.id) throw new OrderError('Not your order.', 403);
  return update(order.id, (o) => {
    if (o.kind !== 'cashout' || o.status !== 'paid') throw new OrderError('Only paid cash-outs can be marked as sent.');
    if (pickupCodeRequired(o)) {
      const typed = (code ?? '').replace(/\D/g, '');
      if (!typed) throw new OrderError("Type in the 6-digit pickup code from the customer's phone first.");
      if (!sameCode(typed, o.pickupCode!)) {
        throw new OrderError("That code doesn't match. Don't hand over cash. Ask the customer to open this order in their own NimPoint app.");
      }
    }
    o.payoutRef = ref?.slice(0, 80);
    transition(o, 'payout_sent');
  });
}

export async function confirmReceived(
  order: Order,
  receipt?: { message: string; publicKey: string; signature: string },
) {
  // A receipt counts only if it is signed by the wallet that made the order.
  const verified = receipt
    ? addressFromPublicKey(receipt.publicKey) === normalizeAddress(order.wallet) && verifyNimiqMessage(receipt.message, receipt.publicKey, receipt.signature)
    : false;
  const next = await update(order.id, (o) => {
    const ok = o.kind === 'cashout' ? ['paid', 'payout_sent', 'disputed'] : ['paid', 'disputed'];
    if (!ok.includes(o.status)) throw new OrderError("This order can't be confirmed yet.");
    if (receipt) o.receipt = { ...receipt, verified };
    transition(o, 'completed');
  });
  await store.del(K.stats(next.agentId, netOf(next)));
  return next;
}

export async function rateOrder(order: Order, stars: number, comment?: string) {
  const next = await update(order.id, (o) => {
    if (o.status !== 'completed') throw new OrderError('You can rate once the order is complete.');
    if (o.rating) throw new OrderError('Already rated. Thank you!');
    o.rating = Math.max(1, Math.min(5, Math.round(stars)));
    o.comment = comment?.slice(0, 280);
  });
  await store.del(K.stats(next.agentId, netOf(next)));
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

/**
 * A refund is only believed once the chain shows it: NIM that left the bond wallet (when bonds are on)
 * with the agent's BONDOUT memo, went to the wallet that really paid, and covers what the customer sent.
 * Each refund transaction can close one order only.
 */
async function verifyRefund(order: Order, hash: string): Promise<ChainTx> {
  if (order.kind !== 'cashout' || !order.tx) {
    throw new OrderError('Only a cash-out paid on-chain can be refunded from the bond. Close it as agent_paid or leave it open.');
  }
  const net = netOf(order);
  const tx = await getTransaction(hash, net);
  if (!tx) throw new OrderError('That refund transaction is not confirmed on-chain yet. Wait for a block and try again.');
  const cfg = bondConfig();
  if (cfg && cfg.network === net && !sameAddress(tx.from, cfg.address)) throw new OrderError('The refund must be paid from the bond wallet.');
  if (tx.memo.trim().toUpperCase() !== bondOutMemo(order.agentId)) {
    throw new OrderError(`The refund must carry the memo ${bondOutMemo(order.agentId)}, so it comes off this agent's bond.`);
  }
  const payer = await ownerOf(order.tx.from, net);
  if (!sameAddress(tx.to, payer) && !sameAddress(tx.to, order.wallet)) throw new OrderError("The refund must go to the customer's wallet.");
  if (tx.nim + 0.005 < order.tx.nim) throw new OrderError(`The refund is ${tx.nim} NIM; the customer sent ${order.tx.nim} NIM.`);
  return tx;
}

/**
 * NimPoint closes a reported order after looking into it: either the agent really paid,
 * or the customer was refunded from the agent's bond (proven on-chain). Frees the bond tied to the order.
 */
export async function resolveDispute(order: Order, outcome: 'agent_paid' | 'refunded', note?: string, refundHash?: string) {
  if (order.status !== 'disputed') throw new OrderError('Only reported orders can be resolved.');
  let refund: ChainTx | undefined;
  if (outcome === 'refunded') {
    if (!refundHash) throw new OrderError('Add the hash of the refund transaction.');
    refund = await verifyRefund(order, refundHash);
    const claimed = await store.setNx(`refund:${refund.hash.toLowerCase()}`, order.id, ORDER_TTL);
    if (!claimed && String(await store.get<string>(`refund:${refund.hash.toLowerCase()}`)) !== order.id) {
      throw new OrderError('That refund transaction already closed another order.');
    }
  }
  try {
    const next = await update(order.id, (o) => {
      if (o.status !== 'disputed') throw new OrderError('Only reported orders can be resolved.');
      o.resolution = outcome;
      if (refund) o.refundTx = toOnchain(refund);
      const what = refund ? `Refunded ${refund.nim} NIM from the agent's bond (tx ${refund.hash.slice(0, 10)}…)` : 'Checked by NimPoint: the agent paid';
      transition(o, 'completed', note ? `${what}. ${note.slice(0, 200)}` : what);
    });
    await store.del(K.stats(next.agentId, netOf(next)));
    return next;
  } catch (err) {
    // The order was not closed, so the refund transaction is free to close it later.
    if (refund) await store.del(`refund:${refund.hash.toLowerCase()}`);
    throw err;
  }
}

/**
 * Orders made before the network was recorded: if the payment is missing on mainnet but
 * present on the test network, it was a test order. Only ever relabels towards "test".
 */
export async function healNetwork(order: Order): Promise<Order> {
  if (order.network || !order.tx || !testnetEnabled()) return order;
  try {
    if (await getTransaction(order.tx.hash, 'mainnet')) return order;
    if (!(await getTransaction(order.tx.hash, 'testnet'))) return order;
    return await update(order.id, (o) => {
      o.network = 'testnet';
    });
  } catch {
    return order;
  }
}

/* ───────────────────────────── listings ───────────────────────────── */

async function loadMany(ids: string[]) {
  return ((await Promise.all(ids.map(getOrder))).filter(Boolean) as Order[]).sort((a, b) => b.createdAt - a.createdAt);
}

export const ordersForWallet = async (wallet: string, limit = 20) => loadMany(await store.lrange(K.byWallet(wallet), 0, limit - 1));
export const ordersForAgent = async (agentId: string, limit = 60) => loadMany(await store.lrange(K.byAgent(agentId), 0, limit - 1));
export const allOrders = async (limit = 1000) => loadMany(await store.lrange(K.all, 0, limit - 1));

/** "Ada Grace Obi" → "A. G. O.": enough for the customer to recognise, not enough to identify them. */
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => `${w[0].toUpperCase()}.`)
    .join(' ');

/**
 * What a browser may see. `reveal` is for the order's own customer and its agent: the full bank details.
 * Anyone else gets the account name as initials and the last 4 digits only.
 * The order secret and pickup code never appear here (see ownerOrder).
 */
export function publicOrder(o: Order, reveal = false): Order {
  const rest: Order = { ...o };
  delete rest.secret;
  delete rest.pickupCode;
  if (reveal || !rest.bank) return rest;
  return { ...rest, bank: { ...rest.bank, accountNumber: `••••${rest.bank.accountNumber.slice(-4)}`, accountName: initials(rest.bank.accountName) } };
}

/** The customer's own view, on the phone that made the order: full details plus the pickup code. */
export function ownerOrder(o: Order): Order {
  return { ...publicOrder(o, true), pickupCode: o.pickupCode };
}

/** True only for the phone holding this order's secret. Old orders without a secret belong to nobody. */
export const isOwner = (o: Order, token: string | null) => Boolean(o.secret) && ownsOrder(o, token);

/** Only the order's creator holds its secret. Old orders made before secrets existed stay open. */
export function ownsOrder(o: Order, token: string | null) {
  if (!o.secret) return true;
  if (!token) return false;
  const a = createHash('sha256').update(o.secret).digest();
  const b = createHash('sha256').update(token).digest();
  return timingSafeEqual(a, b);
}
