'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { registrationMessage, type Network } from '@/lib/config';
import { signReceipt, walletErrorMessage } from '@/lib/nimiq-client';
import { Button, Card } from './ui';

/**
 * One-tap registration. The wallet signs a fixed sentence, which proves a real
 * Nimiq Pay wallet is behind the count on the proof page. No NIM moves.
 */
export function RegisterCard({ wallet, network }: { wallet: string | null; network: Network }) {
  const [registered, setRegistered] = useState<boolean | null>(null);
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!wallet) return;
    api<{ registered: boolean; count: number }>(`/api/users?wallet=${encodeURIComponent(wallet)}&network=${network}`)
      .then((r) => (setRegistered(r.registered), setCount(r.count)))
      .catch(() => undefined);
  }, [wallet, network]);

  if (!wallet || registered === null) return null;

  if (registered)
    return (
      <p className="mt-6 flex items-center justify-center gap-1.5 text-[13px] text-ink-3">
        <svg viewBox="0 0 24 24" className="h-4 w-4 text-naira" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="m5 12.5 4.5 4.5L19 7.5" />
        </svg>
        Registered NimPoint user · {count} registered{network === 'testnet' ? ' on the test network' : ''}
      </p>
    );

  async function register() {
    if (!wallet) return;
    setBusy(true);
    setErr(null);
    try {
      const signed = await signReceipt(registrationMessage(wallet));
      if (!signed) throw new Error('Open NimPoint inside Nimiq Pay to register.');
      const r = await api<{ registered: boolean; count: number }>('/api/users', { method: 'POST', json: { wallet, network, ...signed } });
      setRegistered(r.registered);
      setCount(r.count);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : walletErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-6 p-5">
      <p className="text-[17px] font-semibold tracking-[-0.01em]">Register your wallet</p>
      <p className="mt-1 text-[14px] leading-snug text-ink-2">One tap and free. Your wallet signs a short message to show it is real. No NIM moves and nothing else is shared.</p>
      {err && <p className="mt-2 text-[13px] text-danger">{err}</p>}
      <Button size="md" className="mt-3 w-full" loading={busy} onClick={register}>
        Register with Nimiq Pay
      </Button>
    </Card>
  );
}
