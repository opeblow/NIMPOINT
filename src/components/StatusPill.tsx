import type { Order } from '@/lib/types';

const cx = (...c: (string | false)[]) => c.filter(Boolean).join(' ');

export function statusLabel(o: Pick<Order, 'status' | 'kind' | 'mode'>) {
  switch (o.status) {
    case 'awaiting_payment':
      return 'Awaiting NIM';
    case 'awaiting_fiat':
      return o.mode === 'cash' ? 'Pay cash' : 'Send Naira';
    case 'fiat_sent':
      return 'Agent checking';
    case 'paid':
      return o.kind === 'cashout' ? 'Paying out' : 'NIM arrived';
    case 'payout_sent':
      return 'Naira sent';
    case 'completed':
      return 'Completed';
    case 'expired':
      return 'Expired';
    case 'disputed':
      return 'Reported';
  }
}

export function StatusPill({ order }: { order: Pick<Order, 'status' | 'kind' | 'mode'> }) {
  const s = order.status;
  return (
    <span
      className={cx(
        'shrink-0 rounded-full px-2.5 py-1 text-[12px] font-medium',
        s === 'completed' && 'bg-naira-soft text-naira',
        (s === 'expired' || s === 'disputed') && 'bg-danger-soft text-danger',
        s !== 'completed' && s !== 'expired' && s !== 'disputed' && 'bg-gold-soft text-gold-deep',
      )}
    >
      {statusLabel(order)}
    </span>
  );
}
