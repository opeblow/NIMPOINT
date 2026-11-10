/** Product limits and constants shared by server and client. */
export const LIMITS = {
  minNgn: 500,
  maxNgn: 20_000,
} as const;

/** How long a quoted rate is held while the user pays. */
export const QUOTE_TTL_MS = 30 * 60 * 1000;

/** Every NimPoint payment carries this memo prefix, so anyone can count orders on-chain. */
export const MEMO_PREFIX = 'NIMPOINT';

export const LUNA_PER_NIM = 100_000;

export const EXPLORER_TX = (hash: string) => `https://nimiq.watch/#${hash}`;
export const EXPLORER_ADDRESS = (addr: string) => `https://nimiq.watch/#${addr.replace(/\s+/g, '')}`;
