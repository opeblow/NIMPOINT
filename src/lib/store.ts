import 'server-only';
import { Redis } from '@upstash/redis';

/**
 * Tiny key/value + set + sorted-list interface. Uses Upstash Redis in
 * production (Vercel KV env vars work too) and an in-memory map locally.
 */
interface Store {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSec?: number): Promise<void>;
  /** Set only if missing. Returns true if it was set. */
  setNx(key: string, value: string, ttlSec: number): Promise<boolean>;
  del(key: string): Promise<void>;
  lpush(key: string, value: string): Promise<void>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  sadd(key: string, value: string): Promise<void>;
  smembers(key: string): Promise<string[]>;
  srem(key: string, value: string): Promise<void>;
}

/** Every key is prefixed, so NimPoint can share a Redis database with other apps safely. */
const P = 'nimpoint:';

function redisStore(url: string, token: string): Store {
  const r = new Redis({ url, token });
  return {
    get: (k) => r.get(P + k),
    async set(k, v, ttl) {
      if (ttl) await r.set(P + k, v, { ex: ttl });
      else await r.set(P + k, v);
    },
    async setNx(k, v, ttl) {
      return (await r.set(P + k, v, { nx: true, ex: ttl })) === 'OK';
    },
    async del(k) {
      await r.del(P + k);
    },
    async lpush(k, v) {
      await r.lpush(P + k, v);
    },
    lrange: (k, a, b) => r.lrange<string>(P + k, a, b),
    async sadd(k, v) {
      await r.sadd(P + k, v);
    },
    smembers: (k) => r.smembers(P + k),
    async srem(k, v) {
      await r.srem(P + k, v);
    },
  };
}

function memoryStore(): Store {
  const g = globalThis as unknown as { __nimpointMem?: Map<string, { v: unknown; exp?: number }> };
  const m = (g.__nimpointMem ??= new Map());
  const live = (k: string) => {
    const e = m.get(k);
    if (e?.exp && e.exp < Date.now()) {
      m.delete(k);
      return undefined;
    }
    return e;
  };
  const clone = <T,>(v: T): T => (v === undefined ? v : structuredClone(v));
  return {
    async get<T>(k: string) {
      return (clone(live(k)?.v) as T) ?? null;
    },
    async set(k, v, ttl) {
      m.set(k, { v: clone(v), exp: ttl ? Date.now() + ttl * 1000 : undefined });
    },
    async setNx(k, v, ttl) {
      if (live(k)) return false;
      m.set(k, { v, exp: Date.now() + ttl * 1000 });
      return true;
    },
    async del(k) {
      m.delete(k);
    },
    async lpush(k, v) {
      const list = (live(k)?.v as string[]) ?? [];
      m.set(k, { v: [v, ...list] });
    },
    async lrange(k, a, b) {
      const list = (live(k)?.v as string[]) ?? [];
      return list.slice(a, b === -1 ? undefined : b + 1);
    },
    async sadd(k, v) {
      const s = new Set((live(k)?.v as string[]) ?? []);
      s.add(v);
      m.set(k, { v: [...s] });
    },
    async smembers(k) {
      return (live(k)?.v as string[]) ?? [];
    },
    async srem(k, v) {
      const s = new Set((live(k)?.v as string[]) ?? []);
      s.delete(v);
      m.set(k, { v: [...s] });
    },
  };
}

const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;

if (!url && process.env.VERCEL) {
  console.warn('[nimpoint] No Redis configured: orders will not survive across serverless instances.');
}

export const store: Store = url && token ? redisStore(url, token) : memoryStore();
export const persistent = Boolean(url && token);
