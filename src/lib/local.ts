'use client';

/** Per-device conveniences. Every access is guarded: storage can be blocked in webviews. */
function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

export interface SavedAccount {
  bankCode: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
}

export const savedAccounts = () => read<SavedAccount[]>('np:accounts', []);
export function rememberAccount(a: SavedAccount) {
  const rest = savedAccounts().filter((x) => !(x.accountNumber === a.accountNumber && x.bankCode === a.bankCode));
  write('np:accounts', [a, ...rest].slice(0, 5));
}
export function forgetAccount(a: SavedAccount) {
  write('np:accounts', savedAccounts().filter((x) => !(x.accountNumber === a.accountNumber && x.bankCode === a.bankCode)));
}

export const lastAgent = () => read<string | null>('np:agent', null);
export const rememberAgent = (id: string) => write('np:agent', id);

export const agentKey = () => read<string | null>('np:agent-key', null);
export const rememberAgentKey = (k: string | null) => write('np:agent-key', k);

/** Order secret from creation: proves this device made the order. */
export const orderToken = (id: string) => read<string | null>(`np:ot:${id}`, null);
export const rememberOrderToken = (id: string, token: string) => write(`np:ot:${id}`, token);

export const termsAccepted = () => read<boolean>('np:terms', false);
export const acceptTerms = () => write('np:terms', true);
