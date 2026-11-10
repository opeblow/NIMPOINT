import { z } from 'zod';
import { sameSecret } from '@/lib/agents';
import { fail, handle, ok } from '@/lib/http';
import { getOrder, publicOrder, resolveDispute } from '@/lib/orders';
import { store } from '@/lib/store';

export const dynamic = 'force-dynamic';

const Action = z.object({
  action: z.literal('resolve'),
  id: z.string().min(1).max(16),
  /** agent_paid: the agent showed proof of payment. refunded: the customer was repaid from the agent's bond. */
  outcome: z.enum(['agent_paid', 'refunded']),
  note: z.string().max(200).optional(),
});

/** NimPoint operator actions. Off unless ADMIN_KEY is set. */
export async function POST(req: Request) {
  try {
    const adminKey = process.env.ADMIN_KEY;
    if (!adminKey) return fail('Not found.', 404);
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const tries = Number((await store.get<string>(`auth:admin:${ip}`)) ?? 0);
    if (tries >= 10) return fail('Too many wrong keys. Try again in 15 minutes.', 429);
    if (!sameSecret(req.headers.get('x-admin-key'), adminKey)) {
      await store.set(`auth:admin:${ip}`, String(tries + 1), 15 * 60);
      return fail('Wrong admin key.', 401);
    }
    const body = Action.parse(await req.json());
    const order = await getOrder(body.id);
    if (!order) return fail('Order not found.', 404);
    return ok({ order: publicOrder(await resolveDispute(order, body.outcome, body.note), true) });
  } catch (err) {
    return handle(err);
  }
}
