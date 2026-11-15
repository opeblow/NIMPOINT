#!/usr/bin/env node
// Check NimPoint's registered users without trusting NimPoint's count.
// Downloads the public signed list and re-checks every entry on your own machine:
//   1. the public key really hashes to that Nimiq address, and
//   2. that key really signed "NimPoint registration: I own <address>."
// Usage: node scripts/verify-users.mjs [mainnet|testnet] [https://nimpoint.vercel.app]
import { createHash, createPublicKey, verify } from 'node:crypto';
import { blake2b } from '@noble/hashes/blake2b';

const network = process.argv[2] === 'testnet' ? 'testnet' : 'mainnet';
const base = process.argv[3] ?? 'https://nimpoint.vercel.app';
const SPKI = Buffer.from('302a300506032b6570032100', 'hex');
const BASE32 = '0123456789ABCDEFGHJKLMNPQRSTUVXY';
const norm = (a) => a.replace(/\s+/g, '').toUpperCase();
const spaced = (a) => norm(a).replace(/(.{4})(?=.)/g, '$1 ');

function addressOf(publicKeyHex) {
  const hash = blake2b(Buffer.from(publicKeyHex, 'hex'), { dkLen: 32 }).subarray(0, 20);
  let bits = '';
  for (const b of hash) bits += b.toString(2).padStart(8, '0');
  let body = '';
  for (let i = 0; i < 160; i += 5) body += BASE32[parseInt(bits.slice(i, i + 5), 2)];
  let mod = 0;
  for (const c of body + 'NQ00') for (const d of c >= 'A' ? String(c.charCodeAt(0) - 55) : c) mod = (mod * 10 + Number(d)) % 97;
  return `NQ${String(98 - mod).padStart(2, '0')}${body}`;
}

function signedBy(message, publicKeyHex, signatureHex) {
  const key = createPublicKey({ key: Buffer.concat([SPKI, Buffer.from(publicKeyHex, 'hex')]), format: 'der', type: 'spki' });
  const bytes = Buffer.from(message, 'utf8');
  const prefixed = Buffer.concat([Buffer.from('\x16Nimiq Signed Message:\n' + bytes.length, 'utf8'), bytes]);
  const sig = Buffer.from(signatureHex, 'hex');
  return verify(null, createHash('sha256').update(prefixed).digest(), key, sig) || verify(null, prefixed, key, sig);
}

const res = await fetch(`${base}/api/users?list=1&network=${network}`);
if (!res.ok) throw new Error(`Could not load the list (${res.status}).`);
const { users } = await res.json();
let good = 0;
const seen = new Set();
for (const u of users) {
  const expected = `NimPoint registration: I own ${spaced(u.wallet)}.`;
  let okay = false;
  let why = 'no signature stored';
  if (u.publicKey && u.signature) {
    try {
      if (seen.has(norm(u.wallet))) why = 'duplicate wallet';
      else if (u.message !== expected) why = 'wrong message';
      else if (addressOf(u.publicKey) !== norm(u.wallet)) why = 'key does not match the address';
      else if (!signedBy(u.message, u.publicKey, u.signature)) why = 'bad signature';
      else okay = true;
    } catch {
      why = 'malformed entry';
    }
  }
  seen.add(norm(u.wallet));
  if (okay) good++;
  console.log(`${okay ? 'OK  ' : 'FAIL'}  ${spaced(u.wallet)}  ${u.at ? new Date(u.at).toISOString() : ''}${okay ? '' : '  (' + why + ')'}`);
}
console.log(`\nListed on ${network}: ${users.length}`);
console.log(`Verified signatures: ${good}`);
