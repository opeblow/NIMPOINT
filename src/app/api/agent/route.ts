import { z } from 'zod';
import { agentByKey } from '@/lib/agents';
import { getOrder, isOnline, markPayoutSent, ordersForAgent, publicAgent, reportTransaction, setOnline, syncOrder } from '@/lib/orders';
import { fail, handle, ok } from '@/lib/http';

export const dynamic = 'force-dynamic';

const keyFrom = (req: Request) => req.headers.get('x-agent-key');

async function dashboard(agentId: string) {
  const orders = await ordersForAgent(agentId);
  // Keep open orders fresh so the agent sees payments land without refreshing.
  await Promise.all(orders.filter((o) => Date.now() - o.createdAt < 3600_000).map((o) => syncOrder(o)));
  return orders;
}

export async function GET(req: Request) {
  try {
    const agent = agentByKey(keyFrom(req));
    if (!agent) return fail('Wrong agent key.', 401);
    const [info, orders] = await Promise.all([publicAgent(agent), dashboard(agent.id)]);
    return ok({ agent: info, orders });
  } catch (err) {
    return handle(err);
  }
}

const Action = z.discriminatedUnion('action', [
  z.object({ action: z.literal('online'), online: z.boolean() }),
  z.object({ action: z.literal('payout_sent'), id: z.string(), ref: z.string().max(80).optional() }),
  z.object({ action: z.literal('nim_sent'), id: z.string(), hash: z.string().max(4000) }),
]);

export async function POST(req: Request) {
  try {
    const agent = agentByKey(keyFrom(req));
    if (!agent) return fail('Wrong agent key.', 401);
    const body = Action.parse(await req.json());
    if (body.action === 'online') {
      await setOnline(agent.id, body.online);
      return ok({ online: await isOnline(agent.id) });
    }
    const order = await getOrder(body.id);
    if (!order || order.agentId !== agent.id) return fail('Order not found.', 404);
    const next = body.action === 'payout_sent' ? await markPayoutSent(order, agent, body.ref) : await reportTransaction(order, body.hash);
    return ok({ order: next });
  } catch (err) {
    return handle(err);
  }
}
