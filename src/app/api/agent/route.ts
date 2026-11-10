import { z } from 'zod';
import { agentByKey } from '@/lib/agents';
import {
  cancelAgentSend,
  getOrder,
  isOnline,
  markPayoutSent,
  ordersForAgent,
  publicAgent,
  publicOrder,
  reportTransaction,
  setOnline,
  startAgentSend,
  syncOrder,
} from '@/lib/orders';
import { fail, handle, ok } from '@/lib/http';
import { store } from '@/lib/store';

export const dynamic = 'force-dynamic';

const keyFrom = (req: Request) => req.headers.get('x-agent-key');
const ipFrom = (req: Request) => req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';

/** Max 10 wrong keys per IP per 15 minutes: guessing the agent key is not practical. */
async function authAgent(req: Request) {
  const ip = ipFrom(req);
  const tries = Number((await store.get<string>(`auth:fail:${ip}`)) ?? 0);
  if (tries >= 10) return { error: fail('Too many wrong keys. Try again in 15 minutes.', 429) };
  const agent = agentByKey(keyFrom(req));
  if (!agent) {
    await store.set(`auth:fail:${ip}`, String(tries + 1), 15 * 60);
    return { error: fail('Wrong agent key.', 401) };
  }
  return { agent };
}

async function dashboard(agentId: string) {
  const orders = await ordersForAgent(agentId);
  // Keep recent orders fresh so the agent sees payments (and duplicate payments) land without refreshing.
  return Promise.all(orders.map((o) => (Date.now() - o.createdAt < 24 * 3600_000 ? syncOrder(o) : o)));
}

export async function GET(req: Request) {
  try {
    const { agent, error } = await authAgent(req);
    if (!agent) return error;
    const [info, orders] = await Promise.all([publicAgent(agent), dashboard(agent.id)]);
    return ok({ agent: info, orders: orders.map((o) => publicOrder(o, true)) });
  } catch (err) {
    return handle(err);
  }
}

const Action = z.discriminatedUnion('action', [
  z.object({ action: z.literal('online'), online: z.boolean() }),
  z.object({ action: z.literal('payout_sent'), id: z.string(), ref: z.string().max(80).optional() }),
  z.object({ action: z.literal('nim_sending'), id: z.string(), retry: z.boolean().optional() }),
  z.object({ action: z.literal('nim_cancelled'), id: z.string() }),
  z.object({ action: z.literal('nim_sent'), id: z.string(), hash: z.string().max(4000) }),
]);

export async function POST(req: Request) {
  try {
    const { agent, error } = await authAgent(req);
    if (!agent) return error;
    const body = Action.parse(await req.json());
    if (body.action === 'online') {
      await setOnline(agent.id, body.online);
      return ok({ online: await isOnline(agent.id) });
    }
    const order = await getOrder(body.id);
    if (!order || order.agentId !== agent.id) return fail('Order not found.', 404);
    const next =
      body.action === 'payout_sent'
        ? await markPayoutSent(order, agent, body.ref)
        : body.action === 'nim_sending'
          ? await startAgentSend(order, agent, body.retry)
          : body.action === 'nim_cancelled'
            ? await cancelAgentSend(order, agent)
            : await reportTransaction(order, body.hash);
    return ok({ order: publicOrder(next, true) });
  } catch (err) {
    return handle(err);
  }
}
