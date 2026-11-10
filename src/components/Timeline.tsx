'use client';

import { motion } from 'motion/react';
import type { Order } from '@/lib/types';
import { cx } from './ui';

interface Step {
  key: string;
  label: string;
  sub?: string;
  at?: number;
}

const time = (t?: number) => (t ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : undefined);

export function stepsFor(order: Order, agentName: string): { steps: Step[]; current: number } {
  const at = (s: string) => order.events.find((e) => e.status === s)?.at;
  const cash = order.mode === 'cash';
  if (order.kind === 'cashout') {
    const steps: Step[] = [
      { key: 'created', label: 'Order created', sub: 'Rate locked for 30 minutes', at: order.createdAt },
      { key: 'paid', label: 'NIM received on-chain', sub: 'Verified on the Nimiq blockchain', at: at('paid') },
      { key: 'payout_sent', label: cash ? `${agentName} hands you cash` : `${agentName} sends your Naira`, sub: cash ? 'Show your pickup code' : 'Usually under 10 minutes', at: at('payout_sent') },
      { key: 'completed', label: 'You confirmed receipt', at: at('completed') },
    ];
    const current = { awaiting_payment: 1, expired: 1, paid: 2, payout_sent: 3, completed: 4, disputed: 2, awaiting_fiat: 0, fiat_sent: 0 }[order.status];
    return { steps, current };
  }
  const steps: Step[] = [
    { key: 'created', label: 'Order created', sub: 'Rate locked', at: order.createdAt },
    { key: 'fiat_sent', label: cash ? `You hand ${agentName} cash` : `You send Naira to ${agentName}`, at: at('fiat_sent') },
    { key: 'paid', label: 'NIM arrives in your wallet', sub: 'Verified on the Nimiq blockchain', at: at('paid') },
    { key: 'completed', label: 'You confirmed receipt', at: at('completed') },
  ];
  const current = { awaiting_fiat: 1, fiat_sent: 2, paid: 3, completed: 4, disputed: 2, awaiting_payment: 0, expired: 1, payout_sent: 3 }[order.status];
  return { steps, current };
}

export function Timeline({ order, agentName }: { order: Order; agentName: string }) {
  const { steps, current } = stepsFor(order, agentName);
  return (
    <ol className="relative">
      {steps.map((s, i) => {
        const done = i < current;
        const active = i === current && order.status !== 'completed';
        return (
          <li key={s.key} className="relative flex gap-4 pb-5 last:pb-0">
            {i < steps.length - 1 && (
              <span className="absolute left-[11px] top-7 h-[calc(100%-24px)] w-[2px] overflow-hidden rounded bg-line">
                <motion.span
                  className="block w-full bg-ink"
                  initial={false}
                  animate={{ height: done && i + 1 < current ? '100%' : done ? '50%' : '0%' }}
                  transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                />
              </span>
            )}
            <span
              className={cx(
                'relative mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                done ? 'border-ink bg-ink text-paper' : active ? 'border-ink bg-card' : 'border-line bg-card',
              )}
            >
              {done ? (
                <motion.svg initial={{ scale: 0 }} animate={{ scale: 1 }} viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m5 12.5 4.5 4.5L19 7.5" />
                </motion.svg>
              ) : active ? (
                <span className="h-2 w-2 animate-pulse rounded-full bg-gold" />
              ) : null}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <p className={cx('text-[15px] font-medium', !done && !active && 'text-ink-3')}>{s.label}</p>
                {done && s.at && <span className="shrink-0 text-[13px] text-ink-3 tabular">{time(s.at)}</span>}
              </div>
              {s.sub && (done || active) && <p className="text-[13px] text-ink-3">{s.sub}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
