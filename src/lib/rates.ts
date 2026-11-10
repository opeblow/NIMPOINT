import 'server-only';
import { store } from './store';
import type { Quote } from './types';

const KEY = 'rate:nim-ngn';
const FRESH_MS = 60_000;

/**
 * Mid-market NIM→NGN from CoinGecko, cached for a minute. If CoinGecko is down
 * we keep serving the last good rate (up to 6h) so the app never blanks out.
 */
export async function getQuote(): Promise<Quote> {
  const cached = await store.get<Quote>(KEY);
  if (cached && Date.now() - cached.updatedAt < FRESH_MS) return cached;

  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=nimiq-2&vs_currencies=ngn,usd', {
      cache: 'no-store',
      signal: AbortSignal.timeout(6_000),
      headers: process.env.COINGECKO_API_KEY ? { 'x-cg-demo-api-key': process.env.COINGECKO_API_KEY } : {},
    });
    if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
    const json = (await res.json()) as { 'nimiq-2'?: { ngn?: number; usd?: number } };
    const mid = json['nimiq-2']?.ngn;
    const usd = json['nimiq-2']?.usd;
    if (!mid || !usd) throw new Error('CoinGecko returned no NIM price');
    const quote: Quote = { mid, usd, updatedAt: Date.now(), source: 'CoinGecko' };
    await store.set(KEY, quote, 6 * 3600);
    return quote;
  } catch (err) {
    if (cached) return cached;
    throw err;
  }
}

/**
 * Agent's price. On a cash-out the agent buys NIM a little under mid; on a
 * top-up they sell a little over. That spread is the agent's whole fee.
 */
export function agentRate(mid: number, kind: 'cashout' | 'topup', spreadBps: number) {
  const f = spreadBps / 10_000;
  return kind === 'cashout' ? mid * (1 - f) : mid * (1 + f);
}

/** NIM amounts are rounded up to 2 decimals for cash-outs (user never sends too little) and down for top-ups. */
export function nimFor(ngn: number, rate: number, kind: 'cashout' | 'topup') {
  const raw = ngn / rate;
  return kind === 'cashout' ? Math.ceil(raw * 100) / 100 : Math.floor(raw * 100) / 100;
}
