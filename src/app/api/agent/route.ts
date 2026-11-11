import { z } from 'zod';
import { agentByKey } from '@/lib/agents';
import { bondConfig } from '@/lib/bond';
import {
  cancelAgentSend,
  getOrder,
  isOnline,
  markPayoutSent,
  netOf,
  ordersForAgent,
  publicAgent,
  publicOrder,
  reportTransaction,
  setOnline,
  startAgentSend,
  syncOrder,
  touchAgent,
} from '@/lib/orders';
import { clientIp, fail, handle, ok } from '@/lib/http';
import { store } from '@/lib/store';

export const dynamic = 'force-dynamic';

const keyFrom = (req: Request) => req.headers.get('x-agent-key');
const ipFrom = clientIp;

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
  // Keeps orders fresh so the agent sees payments (and duplicate payments) land without refreshing.
  // Old orders cost nothing here: the sync returns at once and only closes what is due to close.
  return Promise.all(orders.map((o) => syncOrder(o)));
}

export async function GET(req: Request) {
  try {
    const { agent, error } = await authAgent(req);
    if (!agent) return error;
    const [orders] = await Promise.all([dashboard(agent.id), touchAgent(agent.id)]);
    // An agent who has only ever served test wallets sees their test record, clearly marked.
    const net = orders.some((o) => netOf(o) === 'mainnet') || !orders.length ? 'mainnet' : 'testnet';
    const [info, bondView] = await Promise.all([publicAgent(agent, net), bondConfig() ? publicAgent(agent, bondConfig()!.network) : null]);
    return ok({ agent: info, statsNetwork: net, bond: bondView?.bond ?? null, orders: orders.map((o) => publicOrder(o, true)) });
  } catch (err) {
    return handle(err);
  }
}

const Action = z.discriminatedUnion('action', [
  z.object({ action: z.literal('online'), online: z.boolean() }),
  z.object({ action: z.literal('payout_sent'), id: z.string(), ref: z.string().max(80).optional(), code: z.string().max(12).optional() }),
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
        ? await markPayoutSent(order, agent, body.ref, body.code)
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
