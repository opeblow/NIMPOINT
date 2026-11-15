import 'server-only';
import type { Agent } from './agents';
import type { OnchainTx, Order } from './types';
import { ngn, nim } from './format';
import { EXPLORER_TX } from './config';

const token = () => process.env.TELEGRAM_BOT_TOKEN;
export const appUrl = () =>
  process.env.APP_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://localhost:3000');

export async function telegram(method: string, body: Record<string, unknown>) {
  const t = token();
  if (!t) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${t}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(6_000),
    });
    return await res.json();
  } catch (err) {
    console.error('[telegram]', method, err);
    return null;
  }
}

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

/** Alerts never throw: a Telegram outage must not break an order. */
export async function alertAgent(
  agent: Agent,
  order: Order,
  event: 'paid' | 'fiat_sent' | 'disputed' | 'created_cash' | 'extra_payment',
  extra?: OnchainTx,
) {
  if (!agent.telegramChatId) return;
  const console_ = `${appUrl()}/agent`;
  const lines: string[] = [];
  let keyboard: unknown[][] = [[{ text: 'Open console', url: console_ }]];

  if (event === 'paid') {
    const pay = order.payoutNgn ?? order.ngn;
    lines.push(`💸 <b>Pay out ${ngn(pay)}</b> · order <code>${order.id}</code>`);
    lines.push(`Received ${nim(order.tx?.nim ?? order.nim)} on-chain ✅`);
    if (order.network === 'testnet') lines.push('⚠️ <b>TEST ORDER</b>: this is test-network NIM with no value. Do not send real Naira.');
    if (order.mode === 'bank' && order.bank) {
      lines.push('', `<b>${esc(order.bank.accountName)}</b>`, `${esc(order.bank.bankName)} · <code>${order.bank.accountNumber}</code>`);
    } else {
      lines.push('', '🧍 Customer is collecting <b>cash in hand</b>. Before you hand it over, type the 6-digit pickup code from their phone into the console.');
    }
    if (order.tx) lines.push('', `<a href="${EXPLORER_TX(order.tx.hash, order.network)}">View transaction</a>`);
    // Cash pickups are released only in the console, with the customer's code.
    if (order.mode === 'bank') keyboard = [[{ text: `✅ I've paid ${ngn(pay)}`, callback_data: `sent:${order.id}` }], ...keyboard];
  } else if (event === 'fiat_sent') {
    lines.push(`🪙 <b>Top-up ${ngn(order.ngn)}</b> · order <code>${order.id}</code>`);
    lines.push(`Customer says they ${order.mode === 'cash' ? 'handed you cash' : 'sent the Naira'}.`);
    lines.push(`When it's in, send <b>${nim(order.nim)}</b> from the console.`);
  } else if (event === 'extra_payment' && extra) {
    if (order.kind === 'cashout') {
      lines.push(`<b>Extra payment</b> on order <code>${order.id}</code>: another ${nim(extra.nim)} arrived with the same memo.`);
      lines.push(`The customer paid twice. Refund ${nim(extra.nim)} to <code>${order.wallet}</code>.`);
    } else {
      lines.push(`<b>You sent NIM twice</b> for order <code>${order.id}</code> (extra ${nim(extra.nim)}).`);
      lines.push('Ask the customer to send it back.');
    }
    lines.push('', `<a href="${EXPLORER_TX(extra.hash, order.network)}">View transaction</a>`);
  } else if (event === 'created_cash') {
    lines.push(`👋 Walk-up cash-out started: ${ngn(order.ngn)} · <code>${order.id}</code>`);
  } else {
    lines.push(`⚠️ <b>Customer reports a problem</b> with order <code>${order.id}</code> (${ngn(order.ngn)}). Please reach out.`);
  }

  await telegram('sendMessage', {
    chat_id: agent.telegramChatId,
    text: lines.join('\n'),
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: keyboard },
  });
}
