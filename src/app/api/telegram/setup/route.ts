import { appUrl, telegram } from '@/lib/telegram';
import { fail, ok } from '@/lib/http';
import { sameSecret } from '@/lib/agents';

export const dynamic = 'force-dynamic';

/** One-time: GET /api/telegram/setup?key=ADMIN_KEY registers the webhook with Telegram. */
export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get('key');
  if (!sameSecret(key, process.env.ADMIN_KEY)) return fail('Unauthorized', 401);
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_WEBHOOK_SECRET) return fail('Set TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET first.');
  const result = await telegram('setWebhook', {
    url: `${appUrl()}/api/telegram`,
    secret_token: process.env.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ['message', 'callback_query'],
  });
  return ok(result);
}
