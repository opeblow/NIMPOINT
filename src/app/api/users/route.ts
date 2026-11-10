import { z } from 'zod';
import { asNetwork } from '@/lib/config';
import { fail, handle, ok } from '@/lib/http';
import { store } from '@/lib/store';
import { isRegistered, registeredCount, registerUser, RegistrationError } from '@/lib/users';

export const dynamic = 'force-dynamic';

const nimiqAddress = z
  .string()
  .transform((s) => s.replace(/\s+/g, '').toUpperCase())
  .refine((s) => /^NQ[0-9]{2}[0-9A-Z]{32}$/.test(s), 'That Nimiq address looks wrong.');

const RegisterSchema = z.object({
  wallet: nimiqAddress,
  network: z.enum(['mainnet', 'testnet']).default('mainnet'),
  message: z.string().max(200),
  publicKey: z.string().regex(/^[0-9a-f]{64}$/i),
  signature: z.string().regex(/^[0-9a-f]{128}$/i),
});

/** Is this wallet registered, and how many are? */
export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams;
    const net = asNetwork(q.get('network'));
    const wallet = q.get('wallet');
    return ok({ registered: wallet ? await isRegistered(nimiqAddress.parse(wallet), net) : false, count: await registeredCount(net) });
  } catch (err) {
    return handle(err);
  }
}

/** Register a wallet with a signature made by that wallet. */
export async function POST(req: Request) {
  try {
    const body = RegisterSchema.parse(await req.json());
    await registerUser(body);
    await store.del(body.network === 'mainnet' ? 'proof' : `proof:${body.network}`);
    return ok({ registered: true, count: await registeredCount(body.network) });
  } catch (err) {
    if (err instanceof RegistrationError) return fail(err.message, 400);
    return handle(err);
  }
}
