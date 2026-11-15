/** Product limits and constants shared by server and client. */
export const LIMITS = {
  // Lowered from 500 while the first real orders are tested. Raise it back once the flow is proven.
  minNgn: 50,
  maxNgn: 20_000,
} as const;

/** How long a quoted rate is held while the user pays. */
export const QUOTE_TTL_MS = 30 * 60 * 1000;

/** Every NimPoint payment carries this memo prefix, so anyone can count orders on-chain. */
export const MEMO_PREFIX = 'NIMPOINT';

export const LUNA_PER_NIM = 100_000;

/** Nimiq network an order lives on. Test-network NIM has no value, so test orders are kept apart everywhere. */
export type Network = 'mainnet' | 'testnet';
export const asNetwork = (v: unknown): Network => (v === 'testnet' ? 'testnet' : 'mainnet');

const explorer = (net?: Network) => (net === 'testnet' ? 'https://test.nimiq.watch' : 'https://nimiq.watch');
export const EXPLORER_TX = (hash: string, net?: Network) => `${explorer(net)}/#${hash}`;
export const EXPLORER_ADDRESS = (addr: string, net?: Network) => `${explorer(net)}/#${addr.replace(/\s+/g, '')}`;

/** Agents post their bond with this memo, so anyone can add it up on-chain. */
export const bondMemo = (agentId: string) => `${MEMO_PREFIX}-BOND-${agentId.toUpperCase()}`;
/** NIM leaving the bond wallet for an agent (a refund to a customer, or the bond going back) carries this memo. */
export const bondOutMemo = (agentId: string) => `${MEMO_PREFIX}-BONDOUT-${agentId.toUpperCase()}`;

/** A wallet registers by signing exactly this sentence. */
export const registrationMessage = (wallet: string) =>
  `NimPoint registration: I own ${wallet.replace(/\s+/g, '').toUpperCase().replace(/(.{4})(?=.)/g, '$1 ')}.`;
