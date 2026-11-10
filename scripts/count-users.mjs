#!/usr/bin/env node
// Count NimPoint users straight from the Nimiq blockchain. No NimPoint server involved.
// Usage: node scripts/count-users.mjs "NQ.. agent address" ["NQ.. another agent"]
// Optional: NIMIQ_RPC_URL (defaults to the public https://rpc.nimiqwatch.com)
const RPC = process.env.NIMIQ_RPC_URL ?? 'https://rpc.nimiqwatch.com';
const MEMO = /^NIMPOINT-[2-9A-HJKMNP-Z]{8}$/;
const agents = process.argv.slice(2);
if (!agents.length) {
  console.error('Pass at least one agent address.');
  process.exit(1);
}
const norm = (a) => a.replace(/\s+/g, '').toUpperCase();
async function rpc(method, params) {
  const res = await fetch(RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.result?.data ?? json.result;
}
const decode = (hex) => (hex ? Buffer.from(hex, 'hex').toString('utf8') : '');

const payments = new Map();
for (const agent of agents) {
  const txs = await rpc('getTransactionsByAddress', [agent, 500, null]);
  for (const t of txs ?? []) {
    const memo = decode(t.recipientData).trim().toUpperCase();
    if (t.executionResult !== false && norm(t.to) === norm(agent) && MEMO.test(memo)) payments.set(t.hash, t);
  }
}
// Nimiq Pay pays from an HTLC; its `sender` is the user's wallet.
const owners = new Map();
for (const t of payments.values()) {
  if (!owners.has(t.from)) {
    const acc = await rpc('getAccountByAddress', [t.from]).catch(() => null);
    owners.set(t.from, acc?.type === 'htlc' && acc.sender ? acc.sender : t.from);
  }
}
const wallets = new Set([...payments.values()].map((t) => norm(owners.get(t.from))));
console.log(`NimPoint payments on-chain: ${payments.size}`);
console.log(`Unique paying wallets:      ${wallets.size}`);
for (const t of payments.values()) console.log(`  ${new Date(t.timestamp).toISOString()}  ${(t.value / 1e5).toFixed(2).padStart(12)} NIM  ${decode(t.recipientData)}  https://nimiq.watch/#${t.hash}`);
