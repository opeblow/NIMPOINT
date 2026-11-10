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
  if (await store.setNx(K.user(input.network, input.wallet), String(Date.now()), TTL)) {
    await store.sadd(K.all(input.network), normalizeAddress(input.wallet));
  }
}

export const isRegistered = async (wallet: string, net: Network) => (await store.get<string>(K.user(net, wallet))) !== null;
export const registeredCount = async (net: Network) => (await store.smembers(K.all(net))).length;
