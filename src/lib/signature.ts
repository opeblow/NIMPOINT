import 'server-only';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { blake2b } from '@noble/hashes/blake2b';

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const PREFIX = '\x16Nimiq Signed Message:\n';

/**
 * Verify a Nimiq signed message (ed25519 over SHA-256 of the prefixed message,
 * same scheme as the Nimiq Hub). Returns false instead of throwing.
 */
export function verifyNimiqMessage(message: string, publicKeyHex: string, signatureHex: string) {
  try {
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKeyHex, 'hex')]),
      format: 'der',
      type: 'spki',
    });
    const sig = Buffer.from(signatureHex, 'hex');
    const bytes = Buffer.from(message, 'utf8');
    const prefixed = Buffer.concat([Buffer.from(PREFIX + bytes.length, 'utf8'), bytes]);
    const hash = createHash('sha256').update(prefixed).digest();
    return verify(null, hash, key, sig) || verify(null, prefixed, key, sig);
  } catch {
    return false;
  }
}

const BASE32 = '0123456789ABCDEFGHJKLMNPQRSTUVXY';

/** The Nimiq address (no spaces) that belongs to an ed25519 public key. Returns null for a malformed key. */
export function addressFromPublicKey(publicKeyHex: string): string | null {
  if (!/^[0-9a-f]{64}$/i.test(publicKeyHex)) return null;
  const hash = blake2b(Buffer.from(publicKeyHex, 'hex'), { dkLen: 32 }).subarray(0, 20);
  let bits = '';
  for (const b of hash) bits += b.toString(2).padStart(8, '0');
  let body = '';
  for (let i = 0; i < 160; i += 5) body += BASE32[parseInt(bits.slice(i, i + 5), 2)];
  // IBAN-style check digits over body + "NQ00", letters counted as 10..35.
  let mod = 0;
  for (const c of body + 'NQ00') for (const d of c >= 'A' ? String(c.charCodeAt(0) - 55) : c) mod = (mod * 10 + Number(d)) % 97;
  return `NQ${String(98 - mod).padStart(2, '0')}${body}`;
}
