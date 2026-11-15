// Local stand-in for a Nimiq Albatross RPC node, for end-to-end tests.
// POST /_send {from,to,value,data} records a transaction; JSON-RPC answers the calls NimPoint makes.
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';

const txs = [];
const htlcOwners = new Map(); // htlc address -> owner
const norm = (a) => a.replace(/\s+/g, '').toUpperCase();
const port = Number(process.env.PORT ?? 8648);

createServer(async (req, res) => {
  // CORS so browser-based demos can talk to the mock directly.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.end();
  let body = '';
  for await (const c of req) body += c;
  const json = body ? JSON.parse(body) : {};
  const reply = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };

  if (req.url === '/_send') {
    const hash = createHash('sha256').update(JSON.stringify(json) + Math.random()).digest('hex');
    if (json.htlcOwner) htlcOwners.set(norm(json.from), json.htlcOwner);
    txs.unshift({
      hash, from: json.from, to: json.to, value: json.value, fromType: 2, toType: 0,
      recipientData: Buffer.from(json.data ?? '', 'utf8').toString('hex'),
      timestamp: Date.now(), executionResult: true, confirmations: 1,
    });
    return reply({ hash });
  }
  const { method, params = [], id } = json;
  const ok = (data) => reply({ jsonrpc: '2.0', id, result: { data, metadata: null } });
  switch (method) {
    case 'getBlockNumber': return ok(1000);
    case 'getTransactionByHash': return ok(txs.find((t) => t.hash === params[0]) ?? null);
    case 'getTransactionsByAddress': {
      const a = norm(params[0]);
      let list = txs.filter((t) => norm(t.to) === a || norm(t.from) === a);
      // Like Albatross: startAt is the last hash of the previous page, and the next page begins after it.
      if (params[2]) list = list.slice(list.findIndex((t) => t.hash === params[2]) + 1);
      return ok(list.slice(0, params[1] ?? 100));
    }
    case 'getAccountByAddress': {
      const a = norm(params[0]);
      const owner = htlcOwners.get(a);
      if (owner) return ok({ type: 'htlc', balance: 0, sender: owner });
      const balance = txs.reduce((s, t) => s + (norm(t.to) === a ? t.value : 0) - (norm(t.from) === a ? t.value : 0), 0);
      return ok({ type: 'basic', balance: Math.max(0, balance) });
    }
    default: return reply({ jsonrpc: '2.0', id, error: { code: -32601, message: 'not mocked' } });
  }
}).listen(port, () => console.log(`mock nimiq rpc on :${port}`));
