'use client';

import { motion } from 'motion/react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, fetchAgents, fetchQuote } from '@/lib/api';
import { BANKS } from '@/lib/banks';
import { LIMITS } from '@/lib/config';
import * as f from '@/lib/format';
import { acceptTerms, forgetAccount, lastAgent, rememberAccount, rememberAgent, rememberOrderToken, savedAccounts, termsAccepted, type SavedAccount } from '@/lib/local';
import { useWallet } from '@/lib/nimiq-client';
import type { Order, OrderKind, PayoutMode, PublicAgent, Quote } from '@/lib/types';
import CoinStage from './CoinStage';
import { applyKey, Keypad } from './Keypad';
import { OpenInNimiqPay } from './OpenInNimiqPay';
import { RecentOrders } from './RecentOrders';
import { Button, Card, cx, Notice, RollingNumber, Segmented, Stars, Wordmark } from './ui';

function newIdempotencyKey() {
  try {
    return crypto.randomUUID();
  } catch {
    // Older webviews without randomUUID.
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

type Step = 'amount' | 'method' | 'agent' | 'bank' | 'review';

const rateFor = (mid: number, kind: OrderKind, bps: number) => (kind === 'cashout' ? mid * (1 - bps / 1e4) : mid * (1 + bps / 1e4));
const nimFor = (ngn: number, rate: number, kind: OrderKind) =>
  kind === 'cashout' ? Math.ceil((ngn / rate) * 100) / 100 : Math.floor((ngn / rate) * 100) / 100;
const supportsAgent = (a: PublicAgent, kind: OrderKind, mode: PayoutMode) => a.kinds.includes(kind) && a.modes.includes(mode);

export function Flow() {
  const router = useRouter();
  const params = useSearchParams();
  const wallet = useWallet();

  const [kind, setKind] = useState<OrderKind>(params.get('kind') === 'topup' ? 'topup' : 'cashout');
  const [amount, setAmount] = useState('');
  const [step, setStep] = useState<Step>('amount');
  const [dir, setDir] = useState(1);
  const [mode, setMode] = useState<PayoutMode>(params.get('mode') === 'cash' ? 'cash' : 'bank');
  const [agentId, setAgentId] = useState<string | null>(params.get('agent'));
  const walkUp = Boolean(params.get('agent'));

  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [agents, setAgents] = useState<PublicAgent[] | null>(null);

  const [bank, setBank] = useState({ bankCode: '', accountNumber: '', accountName: '' });
  const [saved, setSaved] = useState<SavedAccount[]>([]);
  const [agreed, setAgreed] = useState(false);
  const [termsSeen, setTermsSeen] = useState(true);
  const [creating, setCreating] = useState(false);
  const idem = useRef<{ sig: string; key: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  /* live data */
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetchQuote()
        .then((q) => alive && (setQuote(q), setQuoteError(null)))
        .catch((e: Error) => alive && setQuoteError(e.message));
    void load();
    const t = setInterval(load, 30_000);
    fetchAgents()
      .then((r) => alive && setAgents(r.agents))
      .catch(() => alive && setAgents([]));
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    setSaved(savedAccounts());
    setAgreed(termsAccepted());
    setTermsSeen(termsAccepted());
    if (!params.get('agent')) setAgentId(lastAgent());
    const first = savedAccounts()[0];
    if (first) setBank({ bankCode: first.bankCode, accountNumber: first.accountNumber, accountName: first.accountName });
  }, [params]);

  /* derived */
  const ngnValue = Number(amount || 0);
  const agent = agents?.find((a) => a.id === agentId) ?? null;
  const usable = useMemo(() => (agents ?? []).filter((a) => supportsAgent(a, kind, mode)), [agents, kind, mode]);
  const bestBps = useMemo(() => {
    const pool = (agents ?? []).filter((a) => a.online && a.kinds.includes(kind));
    if (!pool.length) return 150;
    return Math.min(...pool.map((a) => (kind === 'cashout' ? a.cashoutSpreadBps : a.topupSpreadBps)));
  }, [agents, kind]);
  const bps = agent ? (kind === 'cashout' ? agent.cashoutSpreadBps : agent.topupSpreadBps) : bestBps;
  const rate = quote ? rateFor(quote.mid, kind, bps) : null;
  const nimAmount = rate && ngnValue ? nimFor(ngnValue, rate, kind) : 0;
  const maxNgn = Math.min(LIMITS.maxNgn, agent?.maxNgn ?? LIMITS.maxNgn);
  const balanceNgn = wallet.balance !== null && rate ? Math.floor(wallet.balance * rate) : null;

  const amountProblem = (() => {
    if (!ngnValue) return null;
    if (ngnValue < LIMITS.minNgn) return `Minimum is ${f.ngn(LIMITS.minNgn)}`;
    if (ngnValue > maxNgn) return `Maximum is ${f.ngn(maxNgn)} per order`;
    if (kind === 'cashout' && wallet.balance !== null && wallet.balance > 0 && nimAmount > wallet.balance) return `You have ${f.nim(wallet.balance)} (≈ ${f.ngn(balanceNgn ?? 0)})`;
    return null;
  })();

  const bankValid = /^\d{10}$/.test(bank.accountNumber) && bank.bankCode && bank.accountName.trim().length >= 3;

  /* navigation */
  const sequence: Step[] = useMemo(() => {
    const s: Step[] = ['amount'];
    if (!walkUp) s.push('method', 'agent');
    if (kind === 'cashout' && mode === 'bank') s.push('bank');
    s.push('review');
    return s;
  }, [walkUp, kind, mode]);

  const go = useCallback(
    (to: Step) => {
      setDir(sequence.indexOf(to) >= sequence.indexOf(step) ? 1 : -1);
      setError(null);
      setStep(to);
    },
    [sequence, step],
  );
  const next = () => go(sequence[Math.min(sequence.indexOf(step) + 1, sequence.length - 1)]);
  const back = () => go(sequence[Math.max(sequence.indexOf(step) - 1, 0)]);

  const quick = [1000, 5000, 10000, 20000];

  /* create order */
  async function submit() {
    if (!wallet.address || !agent) return;
    setCreating(true);
    setError(null);
    try {
      acceptTerms();
      const body = {
        kind,
        mode,
        agentId: agent.id,
        wallet: wallet.address,
        ngn: ngnValue,
        bank: kind === 'cashout' && mode === 'bank' ? bank : undefined,
      };
      // Same order details → same key, so a retry on a slow network returns the same order.
      const sig = JSON.stringify(body);
      if (idem.current?.sig !== sig) idem.current = { sig, key: newIdempotencyKey() };
      const { order } = await api<{ order: Order }>('/api/orders', {
        method: 'POST',
        json: { ...body, idempotencyKey: idem.current.key },
      });
      if (order.secret) rememberOrderToken(order.id, order.secret);
      rememberAgent(agent.id);
      if (kind === 'cashout' && mode === 'bank') {
        const bankName = BANKS.find((b) => b.code === bank.bankCode)?.name ?? 'Bank';
        rememberAccount({ ...bank, bankName });
      }
      router.push(`/o/${order.id}${kind === 'cashout' ? '?pay=1' : ''}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not create the order. Please try again.');
      setCreating(false);
    }
  }

  const titles: Record<Step, string> = {
    amount: '',
    method: kind === 'cashout' ? 'How do you want your Naira?' : 'How will you pay?',
    agent: 'Choose a NimPoint',
    bank: 'Where should it land?',
    review: 'Check and confirm',
  };

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))]">
      {/* top bar */}
      <header className="flex h-12 items-center justify-between">
        {step === 'amount' ? (
          <Wordmark />
        ) : (
          <button onClick={back} className="-ml-2 flex h-10 items-center gap-1 rounded-full px-2 text-[15px] font-medium text-ink-2" aria-label="Back">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6" />
            </svg>
            Back
          </button>
        )}
        {step === 'amount' ? (
          <WalletChip status={wallet.status} address={wallet.address} />
        ) : (
          <div className="flex gap-1.5" aria-label={`Step ${sequence.indexOf(step) + 1} of ${sequence.length}`}>
            {sequence.slice(1).map((s) => (
              <span key={s} className={cx('h-1.5 rounded-full transition-all duration-300', sequence.indexOf(s) <= sequence.indexOf(step) ? 'w-5 bg-ink' : 'w-1.5 bg-line')} />
            ))}
          </div>
        )}
      </header>

      {/* Enter-only transition: the next screen renders immediately even if animation frames are throttled. */}
        <motion.main
          key={step}
          initial={step === 'amount' && dir === 1 ? false : { opacity: 0, x: dir * 24 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          className="flex flex-1 flex-col"
        >
          {step !== 'amount' && <h1 className="mb-5 mt-3 text-[28px] font-semibold leading-[1.1] tracking-[-0.03em]">{titles[step]}</h1>}

          {/* ───────── amount ───────── */}
          {step === 'amount' && (
            <>
              <section className="relative mt-1 overflow-hidden rounded-[28px] bg-ink text-paper">
                <div className="flex items-center gap-2 px-5 pt-4 [@media(max-height:700px)]:hidden">
                  <div className="min-w-0 flex-1">
                    <p className="font-serif text-[clamp(24px,7.4vw,30px)] leading-[1.02] tracking-[-0.01em]">
                      {kind === 'cashout' ? (
                        <>
                          NIM to Naira,
                          <br />
                          <span className="italic text-gold">in minutes.</span>
                        </>
                      ) : (
                        <>
                          Naira to NIM,
                          <br />
                          <span className="italic text-gold">at a NimPoint.</span>
                        </>
                      )}
                    </p>
                    <p className="mt-2 text-[13px] text-paper/60">Bank transfer or cash in hand · Lagos</p>
                  </div>
                  <CoinStage className="-mr-3 -my-2 h-[clamp(96px,30vw,124px)] w-[clamp(96px,30vw,124px)] shrink-0" />
                </div>
                <div className="mt-1 flex items-center justify-between border-t border-paper/10 px-5 py-3 text-[13px] [@media(max-height:700px)]:mt-0 [@media(max-height:700px)]:border-t-0">
                  <span className="flex items-center gap-2 text-paper/70">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-naira opacity-60" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-[#2bd47f]" />
                    </span>
                    Live rate
                  </span>
                  <span className="font-mono tabular text-paper">
                    {rate ? `1 NIM = ${f.rate(rate)}` : quoteError ? 'Rate unavailable' : '…'}
                  </span>
                </div>
              </section>

              <div className="mt-4">
                <Segmented
                  id="kind"
                  value={kind}
                  onChange={(k) => {
                    setKind(k);
                    setError(null);
                  }}
                  options={[
                    { value: 'cashout', label: 'Cash out' },
                    { value: 'topup', label: 'Top up' },
                  ]}
                />
              </div>

              <div className="flex flex-1 flex-col items-center justify-center py-3 text-center">
                <p className="text-[13px] font-medium uppercase tracking-[0.08em] text-ink-3">{kind === 'cashout' ? 'You receive' : 'You pay'}</p>
                <div className={cx('mt-0.5 flex items-baseline font-semibold leading-[1.1] tracking-[-0.045em]', amount.length > 6 ? 'text-[clamp(40px,12vw,52px)]' : 'text-[clamp(46px,14vw,60px)]', amountProblem ? 'text-danger' : !amount && 'text-ink/25')}>
                  <span className="mr-0.5 text-[0.62em] font-medium">₦</span>
                  <RollingNumber text={amount ? Number(amount).toLocaleString('en-NG') : '0'} />
                </div>
                <div className="h-6 text-[15px] text-ink-2">
                  {amountProblem ? (
                    <span className="text-danger">{amountProblem}</span>
                  ) : nimAmount ? (
                    <span className="tabular">
                      {kind === 'cashout' ? 'You send' : 'You get'} <b className="font-semibold text-ink">{f.nim(nimAmount)}</b>
                    </span>
                  ) : wallet.balance !== null && kind === 'cashout' ? (
                    <span className="tabular">Balance {f.nim(wallet.balance)}</span>
                  ) : (
                    <span>
                      {f.ngn(LIMITS.minNgn)} – {f.ngn(maxNgn)}
                    </span>
                  )}
                </div>
                <div className="mt-3 flex w-full gap-1.5">
                  {quick.map((q) => (
                    <button
                      key={q}
                      onClick={() => setAmount(String(q))}
                      className={cx('h-9 min-w-0 flex-1 rounded-full border px-1 text-[13px] font-medium tabular transition-colors', Number(amount) === q ? 'border-ink bg-ink text-paper' : 'border-line bg-card text-ink-2')}
                    >
                      {q >= 1000 ? `₦${q / 1000}k` : f.ngn(q)}
                    </button>
                  ))}
                  {kind === 'cashout' && balanceNgn !== null && balanceNgn >= LIMITS.minNgn && (
                    <button
                      onClick={() => setAmount(String(Math.min(maxNgn, Math.floor(balanceNgn / 100) * 100)))}
                      className="h-9 min-w-0 flex-1 rounded-full border border-line bg-card px-1 text-[13px] font-medium text-ink-2"
                    >
                      Max
                    </button>
                  )}
                </div>
              </div>

              <Keypad onKey={(k) => setAmount((a) => applyKey(a, k, maxNgn))} />
              <Button className="mt-3 w-full" disabled={!ngnValue || !!amountProblem || !quote} onClick={next}>
                Continue
              </Button>

              <RecentOrders wallet={wallet.address} />

              <footer className="mt-6 flex items-center justify-center gap-4 pb-2 text-[13px] text-ink-3">
                <Link href="/proof" className="underline-offset-4 hover:underline">
                  Live proof
                </Link>
                <span>·</span>
                <Link href="/how" className="underline-offset-4 hover:underline">
                  How it works
                </Link>
                <span>·</span>
                <Link href="/agent" className="underline-offset-4 hover:underline">
                  Become a NimPoint
                </Link>
              </footer>
            </>
          )}

          {/* ───────── method ───────── */}
          {step === 'method' && (
            <div className="space-y-3">
              {(
                [
                  {
                    m: 'bank' as const,
                    title: kind === 'cashout' ? 'To my bank account' : 'Bank transfer',
                    sub: kind === 'cashout' ? 'Any Nigerian bank, OPay, PalmPay, Moniepoint, Kuda' : "Send Naira to the agent's account",
                    tag: 'Remote',
                    icon: (
                      <path d="M3 10h18M5 10v8m4-8v8m6-8v8m4-8v8M3 21h18M12 3l9 5H3z" />
                    ),
                  },
                  {
                    m: 'cash' as const,
                    title: kind === 'cashout' ? 'Cash in hand' : 'Pay with cash',
                    sub: 'Walk up to a NimPoint agent, like a POS stand',
                    tag: 'In person',
                    icon: (
                      <>
                        <rect x="2.5" y="6" width="19" height="12" rx="2" />
                        <circle cx="12" cy="12" r="2.6" />
                        <path d="M6 9.5v5M18 9.5v5" />
                      </>
                    ),
                  },
                ]
              ).map((o) => {
                const available = (agents ?? []).some((a) => supportsAgent(a, kind, o.m));
                return (
                  <motion.button
                    key={o.m}
                    whileTap={{ scale: 0.98 }}
                    disabled={!available}
                    onClick={() => {
                      setMode(o.m);
                      setDir(1);
                      setStep('agent');
                    }}
                    className="flex w-full items-center gap-4 rounded-[24px] border border-line/70 bg-card p-5 text-left shadow-[var(--shadow-card)] disabled:opacity-45"
                  >
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-paper-2">
                      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                        {o.icon}
                      </svg>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="text-[17px] font-semibold tracking-[-0.01em]">{o.title}</span>
                        <span className="rounded-full bg-paper-2 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-ink-3">{o.tag}</span>
                      </span>
                      <span className="mt-0.5 block text-[14px] leading-snug text-ink-2">{available ? o.sub : 'No NimPoint offers this yet'}</span>
                    </span>
                    <svg viewBox="0 0 24 24" className="h-5 w-5 text-ink-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  </motion.button>
                );
              })}
            </div>
          )}

          {/* ───────── agent ───────── */}
          {step === 'agent' && (
            <div className="space-y-3">
              {agents === null && <AgentSkeleton />}
              {agents && usable.length === 0 && <Notice tone="warn">No NimPoint offers this right now. Try the other option, or check back soon.</Notice>}
              {[...usable]
                .sort((a, b) => Number(b.online) - Number(a.online) || (b.stats.ratingAvg ?? 0) - (a.stats.ratingAvg ?? 0))
                .map((a) => {
                  const aRate = quote ? rateFor(quote.mid, kind, kind === 'cashout' ? a.cashoutSpreadBps : a.topupSpreadBps) : null;
                  const tooBig = ngnValue > a.maxNgn;
                  const disabled = !a.online || tooBig;
                  return (
                    <motion.button
                      key={a.id}
                      whileTap={disabled ? undefined : { scale: 0.98 }}
                      disabled={disabled}
                      onClick={() => {
                        setAgentId(a.id);
                        setDir(1);
                        setStep(kind === 'cashout' && mode === 'bank' ? 'bank' : 'review');
                      }}
                      className={cx(
                        'w-full rounded-[24px] border bg-card p-5 text-left shadow-[var(--shadow-card)] transition-colors disabled:opacity-50',
                        agentId === a.id ? 'border-ink' : 'border-line/70',
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <Avatar name={a.name} />
                          <div>
                            <p className="text-[17px] font-semibold tracking-[-0.01em]">{a.name}</p>
                            <p className="text-[13px] text-ink-3">{a.area}</p>
                          </div>
                        </div>
                        <span className={cx('flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium', a.online ? 'bg-naira-soft text-naira' : 'bg-paper-2 text-ink-3')}>
                          <span className={cx('h-1.5 w-1.5 rounded-full', a.online ? 'bg-naira' : 'bg-ink-3')} />
                          {a.online ? 'Online' : 'Offline'}
                        </span>
                      </div>
                      <div className="mt-4 grid grid-cols-3 gap-2 border-t border-line/70 pt-3 text-[13px]">
                        <Stat label="Rating">
                          {a.stats.ratingAvg ? (
                            <span className="flex items-center gap-1">
                              <Stars value={Math.round(a.stats.ratingAvg)} size="sm" />
                              <span className="tabular">{a.stats.ratingAvg.toFixed(1)}</span>
                            </span>
                          ) : (
                            'New'
                          )}
                        </Stat>
                        <Stat label="Completed">{a.stats.completed}</Stat>
                        <Stat label="Typical payout">{a.stats.medianPayoutMins !== null ? `${Math.max(1, Math.round(a.stats.medianPayoutMins))} min` : '—'}</Stat>
                      </div>
                      {aRate && ngnValue > 0 && (
                        <p className="mt-3 rounded-2xl bg-paper-2 px-3 py-2 text-[14px] tabular text-ink-2">
                          {tooBig ? (
                            `Up to ${f.ngn(a.maxNgn)} per order`
                          ) : (
                            <>
                              {kind === 'cashout' ? 'You send' : 'You get'} <b className="text-ink">{f.nim(nimFor(ngnValue, aRate, kind))}</b> · {f.rate(aRate)}/NIM
                            </>
                          )}
                        </p>
                      )}
                    </motion.button>
                  );
                })}
            </div>
          )}

          {/* ───────── bank ───────── */}
          {step === 'bank' && (
            <div className="flex flex-1 flex-col">
              {saved.length > 0 && (
                <div className="mb-5">
                  <p className="mb-2 text-[13px] font-medium text-ink-3">Saved</p>
                  <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
                    {saved.map((s) => {
                      const active = s.accountNumber === bank.accountNumber && s.bankCode === bank.bankCode;
                      return (
                        <div key={s.bankCode + s.accountNumber} className={cx('flex shrink-0 items-center rounded-2xl border bg-card', active ? 'border-ink' : 'border-line')}>
                          <button onClick={() => setBank({ bankCode: s.bankCode, accountNumber: s.accountNumber, accountName: s.accountName })} className="py-2.5 pl-3.5 pr-2 text-left">
                            <span className="block text-[14px] font-medium">{s.accountName}</span>
                            <span className="block text-[12px] text-ink-3">
                              {s.bankName} · {f.maskAccount(s.accountNumber)}
                            </span>
                          </button>
                          <button
                            onClick={() => {
                              forgetAccount(s);
                              setSaved(savedAccounts());
                            }}
                            className="px-2.5 text-ink-3"
                            aria-label={`Remove ${s.accountName}`}
                          >
                            ×
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              <Card className="divide-y divide-line/70 px-4">
                <Field label="Bank">
                  <select value={bank.bankCode} onChange={(e) => setBank({ ...bank, bankCode: e.target.value })} className="w-full appearance-none bg-transparent py-1 text-[17px] outline-none">
                    <option value="">Select bank</option>
                    {BANKS.map((b) => (
                      <option key={b.code} value={b.code}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Account number" hint={bank.accountNumber && bank.accountNumber.length !== 10 ? `${bank.accountNumber.length}/10 digits` : undefined}>
                  <input
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={10}
                    value={bank.accountNumber}
                    onChange={(e) => setBank({ ...bank, accountNumber: e.target.value.replace(/\D/g, '').slice(0, 10) })}
                    placeholder="0123456789"
                    className="w-full bg-transparent py-1 font-mono text-[17px] tracking-wider outline-none placeholder:text-ink/20 tabular"
                  />
                </Field>
                <Field label="Name on account">
                  <input
                    autoComplete="name"
                    value={bank.accountName}
                    onChange={(e) => setBank({ ...bank, accountName: e.target.value.slice(0, 80) })}
                    placeholder="As it appears at your bank"
                    className="w-full bg-transparent py-1 text-[17px] outline-none placeholder:text-ink/25"
                  />
                </Field>
              </Card>
              <p className="mt-3 px-1 text-[13px] leading-snug text-ink-3">The agent checks this name before sending. A mismatch can delay your payout.</p>
              <div className="flex-1" />
              <Button className="mt-6 w-full" disabled={!bankValid} onClick={next}>
                Continue
              </Button>
            </div>
          )}

          {/* ───────── review ───────── */}
          {step === 'review' && (
            <div className="flex flex-1 flex-col">
              {!agent ? (
                <Notice tone="warn">Pick a NimPoint first.</Notice>
              ) : (
                <>
                  <Card className="overflow-hidden">
                    <div className="grid grid-cols-2 divide-x divide-line/70">
                      <div className="p-4">
                        <p className="text-[13px] text-ink-3">You {kind === 'cashout' ? 'send' : 'pay'}</p>
                        <p className="mt-1 text-[22px] font-semibold tracking-[-0.02em] tabular">{kind === 'cashout' ? f.nim(nimAmount) : f.ngn(ngnValue)}</p>
                      </div>
                      <div className="p-4">
                        <p className="text-[13px] text-ink-3">You {kind === 'cashout' ? 'receive' : 'get'}</p>
                        <p className="mt-1 text-[22px] font-semibold tracking-[-0.02em] text-naira tabular">{kind === 'cashout' ? f.ngn(ngnValue) : f.nim(nimAmount)}</p>
                      </div>
                    </div>
                    <dl className="divide-y divide-line/70 border-t border-line/70 px-4 text-[14px]">
                      <Row k="NimPoint">
                        {agent.name} · {agent.area}
                      </Row>
                      <Row k="Rate">{rate ? `1 NIM = ${f.rate(rate)}` : '…'}</Row>
                      <Row k="Agent fee">{(bps / 100).toFixed(1)}% · included in rate</Row>
                      <Row k={kind === 'cashout' ? 'Paid to' : 'You pay by'}>
                        {kind === 'cashout'
                          ? mode === 'bank'
                            ? `${bank.accountName} · ${BANKS.find((b) => b.code === bank.bankCode)?.name ?? ''} ${f.maskAccount(bank.accountNumber)}`
                            : 'Cash in hand, at the NimPoint'
                          : mode === 'bank'
                            ? 'Bank transfer to the agent'
                            : 'Cash, at the NimPoint'}
                      </Row>
                      <Row k="Network fee">Free</Row>
                    </dl>
                  </Card>

                  <ul className="mt-4 space-y-2 px-1 text-[13px] leading-snug text-ink-2">
                    <Li>Your NIM goes wallet-to-wallet to {agent.name}. NimPoint never holds your money.</Li>
                    <Li>The payment is verified on the Nimiq blockchain before the agent pays out.</Li>
                    <Li>Rate held for 30 minutes. If something goes wrong, you can report it from the order page.</Li>
                  </ul>

                  {!termsSeen && (
                    <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-2xl bg-paper-2 p-3 text-[13px] leading-snug text-ink-2">
                      <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[#12130f]" />
                      <span>
                        I understand NimPoint is a peer-to-peer marketplace connecting me with independent agents. It is not a bank or custodian. <Link href="/how#terms" className="underline">Terms</Link>
                      </span>
                    </label>
                  )}

                  <div className="flex-1" />
                  <div className="mt-5 space-y-3">
                    {error && <Notice tone="error">{error}</Notice>}
                    {wallet.status === 'outside' ? (
                      <OpenInNimiqPay compact />
                    ) : wallet.status === 'denied' || (wallet.status === 'ready' && !wallet.address) ? (
                      <>
                        <Notice tone="warn">NimPoint needs to see your wallet address to find your payment. It can never move your NIM.</Notice>
                        <Button className="w-full" onClick={() => void wallet.refresh()}>
                          Allow wallet access
                        </Button>
                      </>
                    ) : (
                      <Button className="w-full" variant={kind === 'cashout' ? 'gold' : 'primary'} loading={creating || wallet.status === 'connecting'} disabled={!agreed || !rate || !!amountProblem} onClick={submit}>
                        {kind === 'cashout' ? `Send ${f.nim(nimAmount)}` : `Start top-up of ${f.ngn(ngnValue)}`}
                      </Button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </motion.main>
    </div>
  );
}

function WalletChip({ status, address }: { status: string; address: string | null }) {
  if (status === 'ready' && address) return <AddressButton address={address} />;
  if (status === 'connecting') return <span className="h-8 w-28 animate-pulse rounded-full bg-paper-2" />;
  return <span className="rounded-full bg-paper-2 px-3 py-1.5 text-[13px] text-ink-3">Preview mode</span>;
}

/** Tap to copy your full wallet address (also how agents find theirs). */
function AddressButton({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
    } catch {
      const t = document.createElement('textarea');
      t.value = address;
      document.body.appendChild(t);
      t.select();
      document.execCommand('copy');
      t.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  return (
    <button onClick={copy} aria-label="Copy my wallet address" className="flex items-center gap-2 rounded-full border border-line bg-card px-3 py-1.5 text-[13px] font-medium">
      <span className="h-2 w-2 rounded-full bg-naira" />
      <span className="font-mono tabular">{copied ? 'Address copied' : f.shortAddress(address)}</span>
    </button>
  );
}

function Avatar({ name }: { name: string }) {
  const initials = name
    .replace(/^NimPoint\s+/i, '')
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gold-soft text-[15px] font-semibold text-gold-deep">{initials}</span>;
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-ink-3">{label}</p>
      <div className="mt-0.5 font-medium text-ink tabular">{children}</div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block py-3">
      <span className="flex justify-between text-[13px] text-ink-3">
        {label}
        {hint && <span className="tabular">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-3">
      <dt className="shrink-0 text-ink-3">{k}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}

function Li({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0 text-naira" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="m5 12.5 4.5 4.5L19 7.5" />
      </svg>
      <span>{children}</span>
    </li>
  );
}

function AgentSkeleton() {
  return (
    <>
      {[0, 1].map((i) => (
        <div key={i} className="h-[150px] animate-pulse rounded-[24px] bg-paper-2" />
      ))}
    </>
  );
}
