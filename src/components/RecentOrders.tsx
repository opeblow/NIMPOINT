'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import * as f from '@/lib/format';
import type { Order } from '@/lib/types';
import { StatusPill } from './StatusPill';

/** Recent orders for this wallet: resume an open one, or repeat a past one. */
export function RecentOrders({ wallet }: { wallet: string | null }) {
  const [orders, setOrders] = useState<Order[] | null>(null);
  useEffect(() => {
    if (!wallet) return;
    api<{ orders: Order[] }>(`/api/orders?wallet=${encodeURIComponent(wallet)}`)
      .then((r) => setOrders(r.orders))
      .catch(() => setOrders([]));
  }, [wallet]);

  if (!orders?.length) return null;
  return (
    <section className="mt-8">
      <h2 className="mb-2 px-1 text-[13px] font-medium uppercase tracking-[0.08em] text-ink-3">Your activity</h2>
      <div className="divide-y divide-line/70 overflow-hidden rounded-[24px] border border-line/70 bg-card">
        {orders.slice(0, 6).map((o) => (
          <Link key={o.id} href={`/o/${o.id}`} className="flex items-center justify-between gap-3 px-4 py-3.5 active:bg-paper-2">
            <div className="min-w-0">
              <p className="text-[15px] font-medium">
                {o.kind === 'cashout' ? 'Cash out' : 'Top up'} · {f.ngn(o.payoutNgn ?? o.ngn)}
              </p>
              <p className="text-[13px] text-ink-3 tabular">
                {f.nim(o.tx?.nim ?? o.nim)} · {f.ago(o.createdAt)}
              </p>
            </div>
            <StatusPill order={o} />
          </Link>
        ))}
      </div>
    </section>
  );
}
