import 'server-only';
import { createHash, createPublicKey, verify } from 'node:crypto';

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
