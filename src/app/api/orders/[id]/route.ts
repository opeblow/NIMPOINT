import { z } from 'zod';
import { getAgent } from '@/lib/agents';
import {
  confirmReceived,
  disputeOrder,
  getOrder,
  isOwner,
  netOf,
  ownerOrder,
  ownsOrder,
  markFiatSent,
  publicAgent,
  publicOrder,
  rateOrder,
  reportTransaction,
  syncOrder,
} from '@/lib/orders';
import { fail, handle, ok } from '@/lib/http';
import type { Order } from '@/lib/types';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** `mine`: the request came from the phone that made the order, so it may see the full details and the pickup code. */
async function view(order: Order, mine: boolean) {
  const agent = getAgent(order.agentId);
  return {
    order: mine ? ownerOrder(order) : publicOrder(order),
    mine,
    agent: agent ? await publicAgent(agent, netOf(order)) : null,
    // Top-up by bank: the user needs to know where to send Naira.
    agentBank: order.kind === 'topup' && order.mode === 'bank' ? agent?.bank ?? null : null,
  };
}

const token = (req: Request) => req.headers.get('x-order-token');

export async function GET(req: Request, { params }: Ctx) {
  try {
    const order = await getOrder((await params).id);
    if (!order) return fail('Order not found.', 404);
    return ok(await view(await syncOrder(order), isOwner(order, token(req))));
  } catch (err) {
    return handle(err);
  }
}

const ActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('tx'), hash: z.string().min(1).max(4000) }),
  z.object({ action: z.literal('fiat_sent') }),
  z.object({
    action: z.literal('confirm'),
    receipt: z
      .object({ message: z.string().max(500), publicKey: z.string().regex(/^[0-9a-f]{64}$/i), signature: z.string().regex(/^[0-9a-f]{128}$/i) })
      .optional(),
  }),
  z.object({ action: z.literal('rate'), stars: z.number().min(1).max(5), comment: z.string().max(280).optional() }),
  z.object({ action: z.literal('dispute'), note: z.string().max(280).optional() }),
  z.object({ action: z.literal('sync') }),
]);

export async function POST(req: Request, { params }: Ctx) {
  try {
    const order = await getOrder((await params).id);
    if (!order) return fail('Order not found.', 404);
    const body = ActionSchema.parse(await req.json());
    // Anyone may report a payment or refresh (both are checked on-chain). Everything else is the creator's call.
    if (body.action !== 'tx' && body.action !== 'sync' && !ownsOrder(order, token(req))) {
      return fail('Only the person who created this order can do that.', 403);
    }
    let next: Order;
    switch (body.action) {
      case 'tx':
        next = await reportTransaction(order, body.hash);
        break;
      case 'fiat_sent':
        next = await markFiatSent(order);
        break;
      case 'confirm':
        next = await confirmReceived(order, body.receipt);
        break;
      case 'rate':
        next = await rateOrder(order, body.stars, body.comment);
        break;
      case 'dispute':
        next = await disputeOrder(order, body.note);
        break;
      case 'sync':
        next = await syncOrder(order, true);
        break;
    }
    return ok(await view(next, isOwner(order, token(req))));
  } catch (err) {
    return handle(err);
  }
}
