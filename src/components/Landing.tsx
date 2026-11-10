'use client';

import { motion } from 'motion/react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, fetchQuote } from '@/lib/api';
import * as f from '@/lib/format';
import type { Proof, Quote } from '@/lib/types';
import CoinStage from './CoinStage';
import { hasPasscode } from './PinGate';
import { Wordmark } from './ui';

const ease = [0.22, 1, 0.36, 1] as const;
const rise = (i: number) => ({ initial: { opacity: 0, y: 18 }, animate: { opacity: 1, y: 0 }, transition: { delay: 0.08 * i, duration: 0.6, ease } });

export function Landing() {
  const router = useRouter();
  const params = useSearchParams();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [proof, setProof] = useState<Proof | null>(null);

  // Returning users and walk-up QR scans go straight in.
  useEffect(() => {
    const qs = params.toString();
    if (hasPasscode() || params.get('agent')) router.replace(`/app${qs ? `?${qs}` : ''}`);
  }, [params, router]);

  useEffect(() => {
    fetchQuote().then(setQuote).catch(() => undefined);
    api<Proof>('/api/proof').then(setProof).catch(() => undefined);
  }, []);

  const start = `/app${params.toString() ? `?${params.toString()}` : ''}`;

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-10 pt-[max(0.75rem,env(safe-area-inset-top))]">
      <header className="flex h-12 items-center justify-between">
        <Wordmark href="/" />
        <Link href="/how" className="text-[14px] font-medium text-ink-2">
          How it works
        </Link>
      </header>

      {/* hero */}
      <section className="relative mt-3 overflow-hidden rounded-[32px] bg-ink px-6 pb-7 pt-7 text-paper">
        <motion.p {...rise(0)} className="text-[13px] font-medium uppercase tracking-[0.14em] text-gold">
          Cash out · Top up · Lagos
        </motion.p>
        <motion.h1 {...rise(1)} className="mt-3 font-serif text-[clamp(40px,12vw,52px)] leading-[0.98] tracking-[-0.01em]">
          Every POS stand,
          <br />
          <span className="italic text-gold">a NIM cash point.</span>
        </motion.h1>
        <motion.p {...rise(2)} className="mt-4 max-w-[30ch] text-[16px] leading-snug text-paper/70">
          Turn NIM into Naira in your bank, or cash in your hand, in minutes. Right inside Nimiq Pay.
        </motion.p>
        <motion.div {...rise(3)} className="relative mx-auto mt-2 h-[220px] w-[220px]">
          <div className="absolute inset-6 rounded-full bg-gold/20 blur-3xl" />
          <CoinStage className="relative h-full w-full" />
        </motion.div>
        <motion.div {...rise(4)}>
          <Link href={start} className="flex h-14 items-center justify-center rounded-full bg-gold text-[17px] font-semibold text-ink active:scale-[0.98]">
            Get started
          </Link>
          <p className="mt-3 text-center font-mono text-[13px] text-paper/60 tabular">{quote ? `Live: 1 NIM = ${f.rate(quote.mid)}` : ' '}</p>
        </motion.div>
      </section>

      {/* live numbers */}
      {proof && proof.ledger.orders > 0 && (
        <motion.section {...rise(5)} className="mt-3 grid grid-cols-3 gap-2">
          <Stat label="Wallets served" value={String(proof.ledger.uniqueWallets)} />
          <Stat label="Naira paid out" value={f.ngn(proof.ledger.volumeNgn)} />
          <Stat label="Avg rating" value={proof.ledger.ratingAvg ? `${proof.ledger.ratingAvg.toFixed(1)}★` : 'New'} />
        </motion.section>
      )}

      {/* features */}
      <section className="mt-8 space-y-3">
        {[
          ['To any bank', 'GTBank, OPay, PalmPay, Moniepoint, Kuda and more. Usually under 10 minutes.', 'M3 10h18M5 10v8m4-8v8m6-8v8m4-8v8M3 21h18M12 3l9 5H3z'],
          ['Cash in hand', 'Scan the NimPoint QR at an agent stand, show your pickup code, collect your cash.', 'M2.5 6h19v12h-19zM12 9.4a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2zM6 9.5v5M18 9.5v5'],
          ['Verified on-chain', 'Every payment is checked on the Nimiq blockchain before the agent pays out.', 'M12 3l7 3v6c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6zM8.5 12.5l2.5 2.5 4.5-5'],
          ['Never custodial', 'Your NIM goes wallet to wallet. NimPoint never holds your money.', 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5zM12 15v2'],
        ].map(([t, d, icon], i) => (
          <motion.div
            key={t}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ delay: i * 0.05, duration: 0.5, ease }}
            className="flex gap-4 rounded-[24px] border border-line/70 bg-card p-5 shadow-[var(--shadow-card)]"
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gold-soft text-gold-deep">
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d={icon} />
              </svg>
            </span>
            <div>
              <p className="text-[17px] font-semibold tracking-[-0.01em]">{t}</p>
              <p className="mt-0.5 text-[14px] leading-snug text-ink-2">{d}</p>
            </div>
          </motion.div>
        ))}
      </section>

      {/* steps */}
      <section className="mt-10">
        <h2 className="px-1 text-[13px] font-medium uppercase tracking-[0.08em] text-ink-3">Three steps</h2>
        <ol className="mt-3 space-y-4 px-1">
          {['Enter how much Naira you want', 'Pay NIM from Nimiq Pay with one tap', 'Get Naira in your bank or in your hand'].map((s, i) => (
            <li key={s} className="flex items-center gap-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink text-[15px] font-semibold text-gold">{i + 1}</span>
              <span className="text-[16px] font-medium">{s}</span>
            </li>
          ))}
        </ol>
      </section>

      <Link href={start} className="mt-10 flex h-14 items-center justify-center rounded-full bg-ink text-[16px] font-medium text-paper active:scale-[0.98]">
        Open NimPoint
      </Link>

      <footer className="mt-8 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[13px] text-ink-3">
        <Link href="/proof">Live proof</Link>
        <span>·</span>
        <Link href="/how#terms">Terms</Link>
        <span>·</span>
        <Link href="/agent">Become a NimPoint</Link>
      </footer>
      <p className="mt-4 text-center text-[12px] leading-snug text-ink-3">
        NimPoint is a peer-to-peer marketplace connecting you with independent agents. Not a bank or custodian.
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[20px] border border-line/70 bg-card p-3">
      <p className="text-[12px] text-ink-3">{label}</p>
      <p className="mt-0.5 text-[18px] font-semibold tracking-[-0.02em] tabular">{value}</p>
    </div>
  );
}
