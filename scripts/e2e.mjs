// End-to-end test of every order path against a running app + mock Nimiq node.
// Usage: APP=http://localhost:3100 RPC=http://localhost:8648 AGENT_KEY=... node scripts/e2e.mjs
const APP = process.env.APP ?? 'http://localhost:3100';
const RPC = process.env.RPC ?? 'http://localhost:8648';
const KEY = process.env.AGENT_KEY ?? 'test-agent-key-123';

const AGENT = 'NQ11 AAAA AAAA AAAA AAAA AAAA AAAA AAAA AAAA';
const USER1 = 'NQ22 BBBB BBBB BBBB BBBB BBBB BBBB BBBB BBBB';
const USER2 = 'NQ44 DDDD DDDD DDDD DDDD DDDD DDDD DDDD DDDD';
const HTLC1 = 'NQ33 CCCC CCCC CCCC CCCC CCCC CCCC CCCC CCCC';
const AGENT_HTLC = 'NQ66 FFFF FFFF FFFF FFFF FFFF FFFF FFFF FFFF';

let passed = 0;
const fail = (msg, extra) => {
  console.error(`✗ ${msg}`, extra ?? '');
  process.exit(1);
};
const check = (cond, msg, extra) => (cond ? (passed++, console.log(`✓ ${msg}`)) : fail(msg, extra));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const secrets = new Map(); // order id -> secret, as the creator's phone keeps it
async function call(path, { method = 'GET', json, key, noToken } = {}) {
  const id = path.match(/^\/api\/orders\/([A-Z0-9]+)/)?.[1];
  const token = id && !noToken ? secrets.get(id) : undefined;
  const res = await fetch(APP + path, {
    method,
    headers: {
      ...(json ? { 'Content-Type': 'application/json' } : {}),
      ...(key ? { 'x-agent-key': key } : {}),
      ...(token ? { 'x-order-token': token } : {}),
    },
    body: json ? JSON.stringify(json) : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (body.order?.secret) secrets.set(body.order.id, body.order.secret);
  return { status: res.status, body };
}
const send = async (from, to, nim, data, htlcOwner) =>
  (await (await fetch(RPC + '/_send', { method: 'POST', body: JSON.stringify({ from, to, value: Math.round(nim * 1e5), data, htlcOwner }) })).json()).hash;

const bank = { bankCode: '058', accountNumber: '0123456789', accountName: 'Ada Lovelace' };

// ── basics
let r = await call('/api/rate');
check(r.status === 200 && r.body.mid > 0, 'live rate loads', r.body);
r = await call('/api/agents');
check(r.body.agents?.length === 1 && r.body.agents[0].online, 'agent listed and online', r.body);

// ── validation
r = await call('/api/orders', { method: 'POST', json: { kind: 'cashout', mode: 'bank', agentId: 'yaba-1', wallet: USER1, ngn: 20, bank } });
check(r.status === 400 && /between/.test(r.body.error), 'rejects amount under minimum', r.body);
r = await call('/api/orders', { method: 'POST', json: { kind: 'cashout', mode: 'bank', agentId: 'yaba-1', wallet: USER1, ngn: 25000, bank } });
check(r.status === 400, 'rejects amount over maximum', r.body);
r = await call('/api/orders', { method: 'POST', json: { kind: 'cashout', mode: 'bank', agentId: 'yaba-1', wallet: USER1, ngn: 5000, bank: { ...bank, accountNumber: '123' } } });
check(r.status === 422 && /10 digits/.test(r.body.error), 'rejects bad account number', r.body);
r = await call('/api/orders', { method: 'POST', json: { kind: 'cashout', mode: 'bank', agentId: 'yaba-1', wallet: 'NQ00 nope', ngn: 5000, bank } });
check(r.status === 422, 'rejects bad wallet address', r.body);
r = await call('/api/orders', { method: 'POST', json: { kind: 'cashout', mode: 'bank', agentId: 'yaba-1', wallet: USER1, ngn: 5000 } });
check(r.status === 400 && /bank account/.test(r.body.error), 'bank cash-out requires an account', r.body);
r = await call('/api/orders', { method: 'POST', json: { kind: 'cashout', mode: 'bank', agentId: 'yaba-1', wallet: AGENT, ngn: 5000, bank } });
check(r.status === 400, "agent can't trade with themselves", r.body);
r = await call('/api/orders/ZZZZZZZZ');
check(r.status === 404, 'unknown order is 404');

// ── cash-out by bank, happy path
r = await call('/api/orders', { method: 'POST', json: { kind: 'cashout', mode: 'bank', agentId: 'yaba-1', wallet: USER1, ngn: 5000, bank } });
check(r.status === 200 && r.body.order.status === 'awaiting_payment', 'cash-out order created', r.body);
const o1 = r.body.order;
check(o1.memo === `NIMPOINT-${o1.id}` && o1.nim > 0, 'order has memo and NIM amount');
r = await call('/api/orders', { method: 'POST', json: { kind: 'cashout', mode: 'bank', agentId: 'yaba-1', wallet: USER1, ngn: 5000, bank } });
check(r.status === 429, 'double-tap within 3s is blocked', r.body);

r = await call(`/api/orders/${o1.id}`);
check(r.body.order.status === 'awaiting_payment', 'no payment yet → still awaiting');
check(r.body.order.bank.accountNumber.startsWith('••••'), 'account number masked on public order view', r.body.order.bank);

// User pays from their Nimiq Pay HTLC; app reports a serialized tx (not a hash) → memo scan must find it.
const h1 = await send(HTLC1, AGENT, o1.nim, o1.memo, USER1);
r = await call(`/api/orders/${o1.id}`, { method: 'POST', json: { action: 'tx', hash: 'deadbeef-not-a-hash' } });
check(r.body.order.status === 'paid' && r.body.order.tx.hash === h1, 'payment found on-chain by memo', r.body.order);
check(r.body.order.payoutNgn === 5000, 'full payout owed');

// Confirm can't be skipped ahead by rating
r = await call(`/api/orders/${o1.id}`, { method: 'POST', json: { action: 'rate', stars: 5 } });
check(r.status === 400, 'cannot rate before completion');

// ── agent console
r = await call('/api/agent', { key: 'wrong-key-xyz' });
check(r.status === 401, 'agent console rejects wrong key');
r = await call('/api/agent', { key: KEY });
const seen = r.body.orders?.find((o) => o.id === o1.id);
check(seen && seen.bank.accountNumber === '0123456789', 'agent sees full account number');
r = await call('/api/agent', { method: 'POST', key: KEY, json: { action: 'payout_sent', id: o1.id, ref: 'GTB-REF-1' } });
check(r.body.order?.status === 'payout_sent', 'agent marks payout sent', r.body);
r = await call('/api/agent', { method: 'POST', key: KEY, json: { action: 'payout_sent', id: o1.id } });
check(r.status === 400, 'cannot mark payout twice');

r = await call(`/api/orders/${o1.id}`, { method: 'POST', json: { action: 'confirm' }, noToken: true });
check(r.status === 403, 'a stranger cannot confirm someone else\'s order', r.body);
r = await call(`/api/orders/${o1.id}`);
check(!r.body.order.secret, 'order secret is never shown on the public view');
r = await call('/api/agent', { key: KEY });
check(r.body.orders.every((o) => !o.secret), 'agent never sees order secrets');
r = await call(`/api/orders/${o1.id}`, { method: 'POST', json: { action: 'confirm' } });
check(r.body.order.status === 'completed', 'user confirms receipt');
r = await call(`/api/orders/${o1.id}`, { method: 'POST', json: { action: 'rate', stars: 5, comment: 'Fast!' } });
check(r.body.order.rating === 5, 'user rates agent');
r = await call(`/api/orders/${o1.id}`, { method: 'POST', json: { action: 'rate', stars: 1 } });
check(r.status === 400, 'cannot rate twice');

// ── a transaction can settle only one order
await sleep(3200);
r = await call('/api/orders', { method: 'POST', json: { kind: 'cashout', mode: 'cash', agentId: 'yaba-1', wallet: USER1, ngn: 2000 } });
const o2 = r.body.order;
r = await call(`/api/orders/${o2.id}`, { method: 'POST', json: { action: 'tx', hash: h1 } });
check(r.body.order.status === 'awaiting_payment', 'reusing an old transaction does not pay a new order');

// wrong memo, right amount → ignored
await send(HTLC1, AGENT, o2.nim, 'NIMPOINT-WRONG123', USER1);
r = await call(`/api/orders/${o2.id}`, { method: 'POST', json: { action: 'sync' } });
check(r.body.order.status === 'awaiting_payment', 'wrong memo is ignored');

// short payment → payout reduced, with a note
await send(HTLC1, AGENT, Math.floor(o2.nim / 2), o2.memo, USER1);
r = await call(`/api/orders/${o2.id}`, { method: 'POST', json: { action: 'sync' } });
check(r.body.order.status === 'paid' && r.body.order.payoutNgn < 2000 && r.body.order.payoutNgn > 900, 'short payment → proportional payout', r.body.order);
check(r.body.order.events.some((e) => e.note), 'short payment is explained');
// cash pickup: user can confirm directly once paid
r = await call(`/api/orders/${o2.id}`, { method: 'POST', json: { action: 'dispute', note: 'agent not at stand' } });
check(r.body.order.status === 'disputed', 'user can report a problem');
r = await call(`/api/orders/${o2.id}`, { method: 'POST', json: { action: 'confirm' } });
check(r.body.order.status === 'completed', 'disputed order can still be confirmed later');

// ── top-up by bank
r = await call('/api/orders', { method: 'POST', json: { kind: 'topup', mode: 'bank', agentId: 'yaba-1', wallet: USER2, ngn: 3000 } });
check(r.status === 200 && r.body.order.status === 'awaiting_fiat', 'top-up order created', r.body);
const o3 = r.body.order;
r = await call(`/api/orders/${o3.id}`);
check(r.body.agentBank?.accountNumber, 'top-up shows agent bank details', r.body);
r = await call(`/api/orders/${o3.id}`, { method: 'POST', json: { action: 'confirm' } });
check(r.status === 400, 'cannot confirm top-up before NIM arrives');
r = await call(`/api/orders/${o3.id}`, { method: 'POST', json: { action: 'fiat_sent' } });
check(r.body.order.status === 'fiat_sent', 'user marks Naira sent');
// agent pays from their own Nimiq Pay HTLC to the user's wallet
const h3 = await send(AGENT_HTLC, USER2, o3.nim, o3.memo, AGENT);
r = await call('/api/agent', { method: 'POST', key: KEY, json: { action: 'nim_sent', id: o3.id, hash: h3 } });
check(r.body.order?.status === 'paid' && r.body.order.tx.hash === h3, 'agent NIM verified on-chain by hash', r.body);
r = await call(`/api/orders/${o3.id}`, { method: 'POST', json: { action: 'confirm' } });
check(r.body.order.status === 'completed', 'top-up completed');

// ── proof
await sleep(100);
r = await call('/api/proof');
check(r.body.ledger.uniqueWallets === 2, 'proof counts 2 unique wallets', r.body.ledger);
check(r.body.ledger.orders === 3, 'proof counts 3 settled orders', r.body.ledger);
check(r.body.chain.memoPayments === 2 && r.body.chain.uniqueSenders === 1, 'chain-only count matches (2 cash-out payments, 1 owner)', r.body.chain);

// ── telegram webhook is locked down
r = await call('/api/telegram', { method: 'POST', json: {} });
check(r.status === 401, 'telegram webhook rejects calls without the secret');

// ── agent offline blocks new orders
await call('/api/agent', { method: 'POST', key: KEY, json: { action: 'online', online: false } });
await sleep(3200);
r = await call('/api/orders', { method: 'POST', json: { kind: 'cashout', mode: 'cash', agentId: 'yaba-1', wallet: USER1, ngn: 2000 } });
check(r.status === 400 && /offline/.test(r.body.error), 'offline agent gets no new orders', r.body);
await call('/api/agent', { method: 'POST', key: KEY, json: { action: 'online', online: true } });

// ── idempotency
const USER3 = 'NQ55 EEEE EEEE EEEE EEEE EEEE EEEE EEEE EEEE';
const idemBody = { kind: 'cashout', mode: 'bank', agentId: 'yaba-1', wallet: USER3, ngn: 4000, bank, idempotencyKey: 'e2e-idem-key-0001' };
r = await call('/api/orders', { method: 'POST', json: idemBody });
check(r.status === 200, 'order created with idempotency key', r.body);
const o4 = r.body.order;
r = await call('/api/orders', { method: 'POST', json: idemBody });
check(r.status === 200 && r.body.order.id === o4.id, 'retry with same key returns the same order', r.body);
r = await call('/api/orders', { method: 'POST', json: { ...idemBody, ngn: 4500 } });
check(r.status === 422, 'same key with different details is refused', r.body);

// many requests at once see one payment: exactly one "paid" event
await send(HTLC1, AGENT, o4.nim, o4.memo, USER3);
await Promise.all([
  ...Array.from({ length: 6 }, () => call(`/api/orders/${o4.id}`, { method: 'POST', json: { action: 'sync' } })),
  ...Array.from({ length: 4 }, () => call(`/api/orders/${o4.id}`)),
  call('/api/agent', { key: KEY }),
]);
r = await call(`/api/orders/${o4.id}`);
check(r.body.order.status === 'paid', 'concurrent syncs settle the order', r.body.order);
check(r.body.order.events.filter((e) => e.status === 'paid').length === 1, 'concurrent syncs record exactly one payment', r.body.order.events);

// payout marked while syncs run is never overwritten
const racing = Array.from({ length: 6 }, () => call(`/api/orders/${o4.id}`, { method: 'POST', json: { action: 'sync' } }));
r = await call('/api/agent', { method: 'POST', key: KEY, json: { action: 'payout_sent', id: o4.id } });
await Promise.all(racing);
check(r.body.order?.status === 'payout_sent', 'agent marks payout during concurrent syncs', r.body);
r = await call(`/api/orders/${o4.id}`);
check(r.body.order.status === 'payout_sent', 'payout_sent survives concurrent syncs', r.body.order);

// user pays twice: second payment is recorded for refund, order unchanged
const hExtra = await send(HTLC1, AGENT, o4.nim, o4.memo, USER3);
r = await call(`/api/orders/${o4.id}`, { method: 'POST', json: { action: 'tx', hash: hExtra } });
check(
  r.body.order.status === 'payout_sent' && r.body.order.extraPayments?.length === 1 && r.body.order.extraPayments[0].hash === hExtra,
  'duplicate payment flagged for refund',
  r.body.order,
);
r = await call(`/api/orders/${o4.id}`, { method: 'POST', json: { action: 'sync' } });
check(r.body.order.extraPayments.length === 1, 'duplicate payment recorded once');

// agent top-up send lock
await sleep(3200);
r = await call('/api/orders', { method: 'POST', json: { kind: 'topup', mode: 'cash', agentId: 'yaba-1', wallet: USER3, ngn: 2500 } });
const o5 = r.body.order;
r = await call('/api/agent', { method: 'POST', key: KEY, json: { action: 'nim_sending', id: o5.id } });
check(r.status === 200 && r.body.order.sendStartedAt > 0, 'agent send takes a lock', r.body);
r = await call('/api/agent', { method: 'POST', key: KEY, json: { action: 'nim_sending', id: o5.id } });
check(r.status === 409, 'second send is blocked', r.body);
r = await call('/api/agent', { method: 'POST', key: KEY, json: { action: 'nim_sending', id: o5.id, retry: true } });
check(r.status === 409 && /Wait/.test(r.body.error), 'retry is blocked while the first send may still land', r.body);
r = await call('/api/agent', { method: 'POST', key: KEY, json: { action: 'nim_cancelled', id: o5.id } });
check(r.status === 200 && !r.body.order.sendStartedAt, 'cancelled send releases the lock', r.body);
r = await call('/api/agent', { method: 'POST', key: KEY, json: { action: 'nim_sending', id: o5.id } });
check(r.status === 200, 'send can start again after a cancel', r.body);
const h5 = await send(AGENT_HTLC, USER3, o5.nim, o5.memo, AGENT);
r = await call('/api/agent', { method: 'POST', key: KEY, json: { action: 'nim_sent', id: o5.id, hash: h5 } });
check(r.body.order?.status === 'paid', 'agent NIM verified', r.body);
r = await call('/api/agent', { method: 'POST', key: KEY, json: { action: 'nim_sending', id: o5.id, retry: true } });
check(r.status === 409 && /already paid/.test(r.body.error), 'no send once the chain shows it paid', r.body);

console.log(`\nAll ${passed} checks passed.`);
