'use client';

import { motion } from 'motion/react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { EXPLORER_ADDRESS, EXPLORER_TX, MEMO_PREFIX } from '@/lib/config';
import * as f from '@/lib/format';
import type { Proof } from '@/lib/types';
import { Card, Spinner, Wordmark } from '@/components/ui';

export default function ProofPage() {
  const [proof, setProof] = useState<Proof | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const load = () =>
      api<Proof>('/api/proof')
        .then((p) => (setProof(p), setErr(null)))
        .catch((e: Error) => setErr(e.message));
    void load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  const l = proof?.ledger;
  const maxDay = Math.max(1, ...(l?.daily.map((d) => d.wallets) ?? [1]));

  return (
    <div className="mx-auto min-h-[100dvh] w-full max-w-2xl px-4 pb-12 pt-[max(0.75rem,env(safe-area-inset-top))]">
      <header className="flex h-12 items-center justify-between">
        <Wordmark />
        <Link href="/" className="text-[14px] font-medium text-ink-2">
          Open app
        </Link>
      </header>

      <h1 className="mt-6 text-[36px] font-semibold leading-[1.02] tracking-[-0.04em]">
        Live proof, <span className="font-serif font-normal italic">on-chain.</span>
      </h1>
      <p className="mt-3 max-w-lg text-[16px] leading-snug text-ink-2">
        Every NimPoint payment carries a <span className="font-mono text-ink">{MEMO_PREFIX}-…</span> memo on the Nimiq blockchain. These numbers come from those
        transactions. Click any one to check it on the explorer.
      </p>

      {err && !proof && <p className="mt-8 text-danger">{err}</p>}
      {!proof && !err && (
        <div className="mt-16 flex justify-center text-ink-3">
          <Spinner className="h-7 w-7" />
        </div>
      )}

      {proof && l && (
        <>
          <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Big label="Unique wallets" value={String(l.uniqueWallets)} accent />
            <Big label="Settled orders" value={String(l.orders)} />
            <Big label="Naira moved" value={f.ngn(l.volumeNgn)} />
            <Big label="Avg rating" value={l.ratingAvg ? `${l.ratingAvg.toFixed(1)} ★` : '—'} />
          </div>

          {l.daily.length > 0 && (
            <Card className="mt-4 p-5">
              <p className="text-[13px] font-medium uppercase tracking-[0.08em] text-ink-3">Unique wallets per day</p>
              <div className="mt-4 flex h-32 items-end gap-1.5">
                {l.daily.slice(-21).map((d, i) => (
                  <div key={d.day} className="group relative flex h-full flex-1 flex-col justify-end">
                    <motion.div
                      initial={{ height: 0 }}
                      animate={{ height: `${(d.wallets / maxDay) * 100}%` }}
                      transition={{ delay: i * 0.03, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                      className="min-h-[3px] rounded-t-md bg-ink"
                    />
                    <span className="pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-ink px-1.5 py-0.5 text-[11px] text-paper opacity-0 transition-opacity group-hover:opacity-100">
                      {d.day.slice(5)} · {d.wallets}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card className="mt-4 p-5">
            <p className="text-[17px] font-semibold tracking-[-0.01em]">Count it yourself</p>
            <p className="mt-1 text-[14px] leading-snug text-ink-2">
              Independently of our database, the chain shows <b className="text-ink tabular">{proof.chain.memoPayments}</b> NimPoint payments into agent wallets, from{' '}
              <b className="text-ink tabular">{proof.chain.uniqueSenders}</b> distinct wallets (Nimiq Pay HTLCs resolved to their owners).
            </p>
            <ul className="mt-3 space-y-1.5 text-[13px]">
              {proof.chain.agents.map((a) => (
                <li key={a.address} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-ink-2">{a.name}</span>
                  <a href={EXPLORER_ADDRESS(a.address)} target="_blank" rel="noreferrer" className="font-mono text-ink underline underline-offset-2">
                    {a.address}
                  </a>
                </li>
              ))}
            </ul>
            <pre className="no-scrollbar mt-4 overflow-x-auto rounded-2xl bg-ink p-4 font-mono text-[12px] leading-relaxed text-paper/90">
              {`node scripts/count-users.mjs ${proof.chain.agents.map((a) => `"${a.address}"`).join(' ') || '"NQ.."'}`}
            </pre>
          </Card>

          <h2 className="mb-2 mt-8 px-1 text-[13px] font-medium uppercase tracking-[0.08em] text-ink-3">Every settled order</h2>
          <Card className="overflow-hidden">
            {l.entries.length === 0 ? (
              <p className="p-5 text-[15px] text-ink-3">No settled orders yet. Be the first.</p>
            ) : (
              <ul className="divide-y divide-line/70">
                {l.entries.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-3 text-[14px]">
                    <div className="min-w-0">
                      <p className="font-medium">
                        {e.kind === 'cashout' ? 'Cash out' : 'Top up'} · {f.ngn(e.ngn)} <span className="text-ink-3">· {f.nim(e.nim)}</span>
                      </p>
                      <p className="truncate font-mono text-[12px] text-ink-3">
                        {f.shortAddress(e.wallet)} · {new Date(e.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                      </p>
                    </div>
                    <a href={EXPLORER_TX(e.tx)} target="_blank" rel="noreferrer" className="shrink-0 rounded-full bg-paper-2 px-3 py-1 font-mono text-[12px] text-ink">
                      {e.tx.slice(0, 6)}↗
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <p className="mt-4 text-center text-[12px] text-ink-3">Updated {f.ago(proof.generatedAt)} · refreshes every 30 seconds</p>
        </>
      )}
    </div>
  );
}

function Big({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={accent ? 'rounded-[24px] bg-ink p-4 text-paper' : 'rounded-[24px] border border-line/70 bg-card p-4'}>
      <p className={accent ? 'text-[13px] text-paper/60' : 'text-[13px] text-ink-3'}>{label}</p>
      <p className={`mt-1 text-[28px] font-semibold tracking-[-0.03em] tabular ${accent ? 'text-gold' : ''}`}>{value}</p>
    </div>
  );
}
