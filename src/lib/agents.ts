import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { OrderKind, PayoutMode } from './types';

const AgentSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{2,32}$/),
  name: z.string().min(1),
  area: z.string().default('Lagos'),
  address: z
    .string()
    .transform((s) => s.replace(/\s+/g, '').toUpperCase().replace(/(.{4})(?=.)/g, '$1 '))
    .refine((s) => /^NQ[0-9]{2}( [0-9A-Z]{4}){8}$/.test(s), 'AGENT_ADDRESS must be a Nimiq address like NQ12 ABCD ...')
    // The all-zero placeholder can never receive orders: NIM sent there would be lost.
    .refine((s) => !/^NQ00( 0000){8}$/.test(s), 'AGENT_ADDRESS is still the placeholder. Set your real Nimiq Pay address.'),
  modes: z.array(z.enum(['bank', 'cash'])).default(['bank', 'cash']),
  kinds: z.array(z.enum(['cashout', 'topup'])).default(['cashout', 'topup']),
  cashoutSpreadBps: z.number().int().min(0).max(1000).default(150),
  topupSpreadBps: z.number().int().min(0).max(1000).default(150),
  maxNgn: z.number().int().positive().default(20_000),
  /** Shown to users for top-ups: where they send Naira. */
  bank: z
    .object({ bankName: z.string(), accountNumber: z.string(), accountName: z.string() })
    .optional(),
  telegram: z.string().optional(),
  telegramChatId: z.string().optional(),
  /** Secret for the agent console. Never sent to the browser. */
  key: z
    .string()
    .min(8)
    .refine((k) => k !== 'change-me-please', 'Set a real AGENT_KEY.'),
});

export type Agent = z.infer<typeof AgentSchema>;

let cache: Agent[] | null = null;

/**
 * Agents come from AGENTS_JSON (an array). A single agent can also be set with
 * AGENT_ADDRESS / AGENT_NAME / AGENT_KEY etc. for a quick start.
 */
export function listAgents(): Agent[] {
  if (cache) return cache;
  const raw = process.env.AGENTS_JSON;
  let parsed: unknown[] = [];
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.error('AGENTS_JSON is not valid JSON');
    }
  } else if (process.env.AGENT_ADDRESS) {
    parsed = [
      {
        id: process.env.AGENT_ID ?? 'yaba-1',
        name: process.env.AGENT_NAME ?? 'NimPoint Yaba',
        area: process.env.AGENT_AREA ?? 'Yaba, Lagos',
        address: process.env.AGENT_ADDRESS,
        key: process.env.AGENT_KEY ?? '',
        telegram: process.env.AGENT_TELEGRAM,
        telegramChatId: process.env.AGENT_TELEGRAM_CHAT_ID,
        bank: process.env.AGENT_BANK_NAME
          ? {
              bankName: process.env.AGENT_BANK_NAME,
              accountNumber: process.env.AGENT_BANK_ACCOUNT ?? '',
              accountName: process.env.AGENT_BANK_ACCOUNT_NAME ?? '',
            }
          : undefined,
      },
    ];
  }
  cache = parsed.flatMap((a) => {
    const r = AgentSchema.safeParse(a);
    if (!r.success) console.error('Invalid agent config', r.error.issues);
    return r.success ? [r.data] : [];
  });
  return cache;
}

export const getAgent = (id: string) => listAgents().find((a) => a.id === id);

const digest = (s: string) => createHash('sha256').update(s).digest();

/** Constant-time compare, so response timing can't leak the key. */
export function sameSecret(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b) return false;
  return timingSafeEqual(digest(a), digest(b));
}

export const agentByKey = (key: string | null | undefined) => (key ? listAgents().find((a) => sameSecret(a.key, key)) : undefined);

export function supports(agent: Agent, kind: OrderKind, mode: PayoutMode) {
  if (!agent.kinds.includes(kind) || !agent.modes.includes(mode)) return false;
  // Top-ups by bank need the agent's account details to show the user.
  if (kind === 'topup' && mode === 'bank' && !agent.bank) return false;
  return true;
}
