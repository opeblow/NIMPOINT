import 'server-only';
import { registrationMessage, type Network } from './config';
import { normalizeAddress } from './nimiq-rpc';
import { addressFromPublicKey, verifyNimiqMessage } from './signature';
import { store } from './store';

const K = {
  user: (net: Network, w: string) => `user:${net}:${normalizeAddress(w)}`,
  all: (net: Network) => `users:${net}`,
};
const TTL = 60 * 60 * 24 * 365 * 5;

export class RegistrationError extends Error {}

/**
 * Register a wallet. The wallet signs a fixed sentence, and the signing key
 * must hash to that same address, so nobody can register a wallet they don't hold.
 */
export async function registerUser(input: { wallet: string; network: Network; message: string; publicKey: string; signature: string }) {
  if (input.message !== registrationMessage(input.wallet)) throw new RegistrationError('That registration message is not the one NimPoint asked for.');
  if (addressFromPublicKey(input.publicKey) !== normalizeAddress(input.wallet)) throw new RegistrationError('That signature is from a different wallet.');
  if (!verifyNimiqMessage(input.message, input.publicKey, input.signature)) throw new RegistrationError('The signature did not check out. Please try again.');
  if (await store.setNx(K.user(input.network, input.wallet), JSON.stringify({ at: Date.now(), publicKey: input.publicKey.toLowerCase(), signature: input.signature.toLowerCase() }), TTL)) {
    await store.sadd(K.all(input.network), normalizeAddress(input.wallet));
  }
}

export async function isRegistered(wallet: string, _net: Network) {
  const [mainnet, testnet] = await Promise.all([
    store.get<unknown>(K.user('mainnet', wallet)),
    store.get<unknown>(K.user('testnet', wallet)),
  ]);
  return mainnet !== null || testnet !== null;
}

export interface RegisteredUser {
  wallet: string;
  /** When the wallet registered (ms). */
  at: number;
  /** The exact sentence the wallet signed. */
  message: string;
  /** Kept for every registration made since proofs are stored, so anyone can re-check the signature. */
  publicKey?: string;
  signature?: string;
}

export async function registrationSnapshot() {
  const [mainnet, testnet] = await Promise.all([listUsers('mainnet'), listUsers('testnet')]);
  const byWallet = new Map<string, RegisteredUser>();
  for (const user of [...mainnet, ...testnet]) {
    const key = normalizeAddress(user.wallet);
    const existing = byWallet.get(key);
    if (!existing || ((!existing.publicKey || !existing.signature) && user.publicKey && user.signature)) {
      byWallet.set(key, existing ? { ...user, at: Math.min(existing.at, user.at) } : user);
    }
  }
  return { all: [...byWallet.values()].sort((a, b) => a.at - b.at), byNetwork: { mainnet, testnet } };
}

/** Every registered wallet with its signed proof, oldest first. Public by design: it is what makes the count checkable. */
export async function listUsers(net: Network): Promise<RegisteredUser[]> {
  const wallets = await store.smembers(K.all(net));
  const rows = await Promise.all(
    wallets.map(async (wallet) => {
      let v = await store.get<unknown>(K.user(net, wallet));
      if (typeof v === 'string') {
        try {
          v = JSON.parse(v);
        } catch {
          /* an old record: just a timestamp */
        }
      }
      const rec = v && typeof v === 'object' ? (v as { at?: number; publicKey?: string; signature?: string }) : { at: Number(v) || 0 };
      return { wallet, at: rec.at ?? 0, message: registrationMessage(wallet), publicKey: rec.publicKey, signature: rec.signature };
    }),
  );
  return rows.sort((a, b) => a.at - b.at);
}

export async function listAllUsers(): Promise<RegisteredUser[]> {
  return (await registrationSnapshot()).all;
}

export const registeredCount = async () => (await listAllUsers()).length;
