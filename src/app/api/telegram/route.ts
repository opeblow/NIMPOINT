import { listAgents, sameSecret } from '@/lib/agents';
import { getOrder, markPayoutSent } from '@/lib/orders';
import { ok } from '@/lib/http';
import { telegram } from '@/lib/telegram';
import { ngn } from '@/lib/format';

export const dynamic = 'force-dynamic';

interface Update {
  message?: { chat: { id: number }; text?: string };
  callback_query?: { id: string; data?: string; message?: { chat: { id: number }; message_id: number; text?: string } };
}

/** Telegram webhook: agents tap "I've paid" right in the alert. */
export async function POST(req: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!sameSecret(req.headers.get('x-telegram-bot-api-secret-token'), secret)) return ok({ ok: false }, { status: 401 });

  const update = (await req.json().catch(() => ({}))) as Update;

  // "/start" tells a new agent their chat id, which goes into their agent config.
  if (update.message?.text?.startsWith('/start')) {
    await telegram('sendMessage', {
      chat_id: update.message.chat.id,
      text: `Hi! Your chat id is ${update.message.chat.id}. Add it to your NimPoint agent config to get order alerts.`,
    });
    return ok({ ok: true });
  }

  const cb = update.callback_query;
  if (cb?.data?.startsWith('sent:') && cb.message) {
    const chatId = String(cb.message.chat.id);
    const agent = listAgents().find((a) => a.telegramChatId === chatId);
    const order = await getOrder(cb.data.slice(5));
    let reply = 'Order not found.';
    if (agent && order && order.agentId === agent.id && order.status !== 'paid') {
      // Telegram retries webhooks and agents double-tap: a repeat is not an error.
      reply = order.status === 'payout_sent' || order.status === 'completed' ? 'Already marked as paid.' : `Order is ${order.status.replace('_', ' ')}.`;
    } else if (agent && order && order.agentId === agent.id) {
      try {
        await markPayoutSent(order, agent);
        reply = `Marked as paid. The customer has been told ${ngn(order.payoutNgn ?? order.ngn)} is on the way.`;
        await telegram('editMessageReplyMarkup', { chat_id: chatId, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] } });
        await telegram('sendMessage', { chat_id: chatId, text: `✅ ${order.id}: ${reply}` });
      } catch (err) {
        reply = (err as Error).message;
      }
    }
    await telegram('answerCallbackQuery', { callback_query_id: cb.id, text: reply });
  }
  return ok({ ok: true });
}
