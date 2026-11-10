'use client';

import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, fetchOrder, orderAction, type OrderView } from '@/lib/api';
import { EXPLORER_TX } from '@/lib/config';
import * as f from '@/lib/format';
import { payWithMemo, signReceipt, useWallet, walletErrorMessage } from '@/lib/nimiq-client';
import type { Order } from '@/lib/types';
import CoinStage from './CoinStage';
import { OpenInNimiqPay } from './OpenInNimiqPay';
import { StatusPill } from './StatusPill';
import { Timeline } from './Timeline';
import { Button, Card, CopyField, Notice, Sheet, Spinner, Stars, Wordmark } from './ui';

const TERMINAL = new Set(['completed']);
const RETRY_AFTER_MS = 3 * 60_000;

function sentKey(id: string) {
  return `np:sent:${id}`;
}
function readSent(id: string): number | null {
  try {
    const v = localStorage.getItem(sentKey(id));
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}
function writeSent(id: string) {
  try {
    localStorage.setItem(sentKey(id), String(Date.now()));
  } catch {
    /* ignore */
  }
}

export function OrderScreen({ id }: { id: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const wallet = useWallet();
  const [view, setView] = useState<OrderView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [disputeOpen, setDisputeOpen] = useState(false);
  const autoPayTried = useRef(false);

  const order = view?.order;
  const agentName = view?.agent?.name ?? 'The agent';

  const load = useCallback(async () => {
    try {
      const v = await fetchOrder(id);
      setView(v);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : 'Could not load your order.');
    }
  }, [id]);

  useEffect(() => {
    setSentAt(readSent(id));
    void load();
  }, [id, load]);

  // Poll while something is pending. Slower once it's quiet.
  useEffect(() => {
    if (!order || TERMINAL.has(order.status)) return;
    const quiet = order.status === 'expired' || order.status === 'awaiting_fiat';
    const t = setInterval(load, quiet ? 10_000 : 4_000);
    return () => clearInterval(t);
  }, [order, load]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const run = async (name: string, fn: () => Promise<OrderView>) => {
    setBusy(name);
    setActionError(null);
    try {
      setView(await fn());
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  };

  const pay = useCallback(async () => {
    if (!order) return;
    setBusy('pay');
    setActionError(null);
    try {
      // "Pay again": ask the server to check the chain first. If the first payment landed, stop here.
      if (sentAt !== null) {
        const fresh = await orderAction(order.id, { action: 'sync' });
        setView(fresh);
        if (fresh.order.status !== 'awaiting_payment' && fresh.order.status !== 'expired') return;
      }
      const result = await payWithMemo(order.nimRecipient, order.nim, order.memo);
      writeSent(order.id);
      setSentAt(Date.now());
      setView(await orderAction(order.id, { action: 'tx', hash: String(result) }));
    } catch (e) {
      const msg = walletErrorMessage(e);
      // An uncertain outcome counts as sent: never invite a second payment.
      if (msg.includes("isn't sure")) {
        writeSent(order.id);
        setSentAt(Date.now());
      }
      setActionError(msg);
    } finally {
      setBusy(null);
    }
  }, [order, sentAt]);

  // Came straight from "Send": open the Nimiq Pay prompt once.
  useEffect(() => {
    if (autoPayTried.current || params.get('pay') !== '1' || !order || wallet.status !== 'ready') return;
    autoPayTried.current = true;
    router.replace(`/o/${id}`);
    if (order.status === 'awaiting_payment' && !readSent(order.id)) void pay();
  }, [params, order, wallet.status, pay, router, id]);

  async function confirm() {
    if (!order) return;
    await run('confirm', async () => {
      const what = order.kind === 'cashout' ? f.ngn(order.payoutNgn ?? order.ngn) : f.nim(order.tx?.nim ?? order.nim);
      let receipt;
      try {
        receipt = await signReceipt(`NimPoint receipt ${order.id}: I received ${what} from ${agentName}.`);
      } catch {
        receipt = undefined; // Signing is a bonus. Confirmation still goes through.
      }
      return orderAction(order.id, { action: 'confirm', receipt });
    });
  }

  if (loadError && !view)
    return (
      <Shell>
        <div className="mt-16 text-center">
          <p className="text-[20px] font-semibold">{loadError}</p>
          <Button variant="ghost" size="md" className="mt-6" onClick={load}>
            Try again
          </Button>
        </div>
      </Shell>
    );
  if (!order)
    return (
      <Shell>
        <div className="mt-24 flex justify-center text-ink-3">
          <Spinner className="h-7 w-7" />
        </div>
      </Shell>
    );

  const cash = order.mode === 'cash';
  const payout = order.payoutNgn ?? order.ngn;
  const lockLeft = Math.max(0, order.expiresAt - now);
  const waitingChain = order.status === 'awaiting_payment' && sentAt !== null;
  const canRetryPay = sentAt === null || now - sentAt > RETRY_AFTER_MS;
  const shortNote = order.kind === 'cashout' ? order.events.find((e) => e.status === 'paid' && e.note)?.note : undefined;

  return (
    <Shell>
      {/* headline */}
      <motion.section key={order.status + String(waitingChain)} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }} className="mt-2">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[13px] text-ink-3">#{order.id}</span>
            <StatusPill order={order} />
          </div>
          <Headline order={order} agentName={agentName} waitingChain={waitingChain} />
      </motion.section>

      <div className="mt-5 space-y-4">
        {order.network === 'testnet' && <Notice tone="warn">Test order. This NIM is on the Nimiq test network and has no real value, so no real Naira is owed.</Notice>}
        {actionError && <Notice tone="error">{actionError}</Notice>}
        {order.extraPayments?.length ? (
          <Notice tone="warn">
            {order.kind === 'cashout'
              ? `We also received ${f.nim(order.extraPayments.reduce((a, t) => a + t.nim, 0))} more with this order's code. That's an extra payment: ${agentName} has been told to refund it to your wallet.`
              : `${agentName} sent you ${f.nim(order.extraPayments.reduce((a, t) => a + t.nim, 0))} more than this order. Please send it back to them.`}
          </Notice>
        ) : null}
        {shortNote && order.status !== 'completed' && (
          <Notice tone="warn">
            {shortNote}. You&apos;ll receive {f.ngn(payout)}.
          </Notice>
        )}

        {/* ── cash-out: pay ── */}
        {order.kind === 'cashout' && order.status === 'awaiting_payment' && (
          <Card className="p-5">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-[13px] text-ink-3">Amount</p>
                <p className="text-[28px] font-semibold tracking-[-0.03em] tabular">{f.nim(order.nim)}</p>
              </div>
              <div className="text-right">
                <p className="text-[13px] text-ink-3">Rate locked</p>
                <p className="font-mono text-[17px] tabular">{fmtCountdown(lockLeft)}</p>
              </div>
            </div>
            <div className="mt-4">
              {wallet.status === 'outside' ? (
                <OpenInNimiqPay compact />
              ) : waitingChain ? (
                <div className="flex items-center gap-3 rounded-2xl bg-paper-2 p-4 text-[14px] text-ink-2">
                  <Spinner className="h-5 w-5 shrink-0" />
                  <span>Looking for your payment on the Nimiq blockchain. This usually takes a few seconds. You can close the app; we&apos;ll keep checking.</span>
                </div>
              ) : null}
              {wallet.status !== 'outside' && canRetryPay && (
                <Button variant="gold" className="mt-3 w-full" loading={busy === 'pay' || wallet.status === 'connecting'} onClick={pay}>
                  {sentAt ? 'Not in your Nimiq Pay history? Pay again' : `Pay ${f.nim(order.nim)} with Nimiq Pay`}
                </Button>
              )}
            </div>
          </Card>
        )}

        {order.status === 'expired' && (
          <Card className="p-5">
            <p className="text-[15px] leading-snug text-ink-2">
              No payment arrived within 30 minutes, so this quote expired. If you did pay, don&apos;t worry: we keep watching the chain for 24 hours and this order will update by itself.
            </p>
            <Link href="/app" className="mt-4 flex h-12 items-center justify-center rounded-full bg-ink text-[15px] font-medium text-paper">
              Start a new order
            </Link>
          </Card>
        )}

        {/* ── cash pickup code ── */}
        {cash && ((order.kind === 'cashout' && ['paid', 'payout_sent'].includes(order.status)) || (order.kind === 'topup' && order.status === 'awaiting_fiat')) && (
          <Card className="overflow-hidden">
            <div className="bg-ink px-5 py-6 text-center text-paper">
              <p className="text-[13px] uppercase tracking-[0.12em] text-paper/60">{order.kind === 'cashout' ? 'Pickup code' : 'Show this code'}</p>
              <p className="mt-2 font-mono text-[40px] font-semibold tracking-[0.12em]">
                {order.id.slice(0, 4)} {order.id.slice(4)}
              </p>
              <p className="mt-1 text-[14px] text-paper/70">
                {order.kind === 'cashout' ? `Show this to ${agentName}. They hand you ${f.ngn(payout)}.` : `Hand ${f.ngn(order.ngn)} to ${agentName}.`}
              </p>
            </div>
          </Card>
        )}

        {/* ── top-up: send Naira ── */}
        {order.kind === 'topup' && order.status === 'awaiting_fiat' && (
          <Card className="px-5 py-2">
            {!cash && view?.agentBank && (
              <div className="divide-y divide-line/70">
                <CopyField label="Amount (send exactly)" value={String(order.ngn)} display={f.ngn(order.ngn)} />
                <CopyField label="Bank" value={view.agentBank.bankName} mono={false} />
                <CopyField label="Account number" value={view.agentBank.accountNumber} />
                <CopyField label="Account name" value={view.agentBank.accountName} mono={false} />
                <CopyField label="Narration / reference" value={order.id} />
              </div>
            )}
            <div className="py-3">
              <Button className="w-full" loading={busy === 'fiat'} onClick={() => run('fiat', () => orderAction(order.id, { action: 'fiat_sent' }))}>
                {cash ? "I've handed over the cash" : `I've sent ${f.ngn(order.ngn)}`}
              </Button>
              <p className="mt-2 text-center text-[13px] text-ink-3">You&apos;ll get {f.nim(order.nim)} as soon as {agentName} confirms.</p>
            </div>
          </Card>
        )}

        {/* ── confirm receipt ── */}
        {((order.kind === 'cashout' && ['paid', 'payout_sent', 'disputed'].includes(order.status)) ||
          (order.kind === 'topup' && ['paid', 'disputed'].includes(order.status))) && (
          <Card className="p-5">
            <p className="text-[15px] leading-snug text-ink-2">
              {order.kind === 'cashout'
                ? cash
                  ? `Got ${f.ngn(payout)} in your hand? Count it, then confirm.`
                  : order.status === 'paid'
                    ? `Once ${f.ngn(payout)} lands in your ${order.bank?.bankName ?? 'bank'} account, confirm here.`
                    : `Check your ${order.bank?.bankName ?? 'bank'} app for ${f.ngn(payout)} from ${agentName}.`
                : `${f.nim(order.tx?.nim ?? order.nim)} has landed in your Nimiq Pay wallet.`}
            </p>
            {order.kind === 'cashout' && view?.agent?.bond && view.agent.bond.nim > 0 && (
              <p className="mt-2 text-[13px] leading-snug text-naira">
                Protected by {agentName}&apos;s bond of {f.ngn(view.agent.bond.ngn)}. If the money never comes, report it and NimPoint refunds you from the bond.
              </p>
            )}
            <Button className="mt-4 w-full" loading={busy === 'confirm'} onClick={confirm}>
              {order.kind === 'cashout' ? "I've received my Naira" : 'Confirm received'}
            </Button>
            {order.kind === 'cashout' && order.status === 'payout_sent' && (
              <p className="mt-2 text-center text-[12px] leading-snug text-ink-3">Only confirm once the money is in your account. With no confirmation and no report for 24 hours, the order closes by itself.</p>
            )}
            {order.status !== 'disputed' && order.kind === 'cashout' && (
              <Button variant="quiet" size="sm" className="mt-2 w-full" onClick={() => setDisputeOpen(true)}>
                Not received?
              </Button>
            )}
          </Card>
        )}
        {order.kind === 'topup' && order.status === 'fiat_sent' && (
          <Button variant="quiet" size="sm" className="w-full" onClick={() => setDisputeOpen(true)}>
            Taking too long?
          </Button>
        )}

        {/* ── rate ── */}
        {order.status === 'completed' && <RateCard order={order} agentName={agentName} onDone={setView} />}

        {/* ── progress ── */}
        <Card className="p-5">
          <Timeline order={order} agentName={agentName} />
        </Card>

        <Receipt order={order} agentName={agentName} />

        <Link href="/app" className="flex h-12 items-center justify-center text-[15px] font-medium text-ink-2">
          Back to NimPoint
        </Link>
      </div>

      <Sheet open={disputeOpen} onClose={() => setDisputeOpen(false)} title="Something wrong?">
        <DisputeForm
          telegram={view?.agent?.telegram}
          busy={busy === 'dispute'}
          onSubmit={async (note) => {
            await run('dispute', () => orderAction(order.id, { action: 'dispute', note }));
            setDisputeOpen(false);
          }}
        />
      </Sheet>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto min-h-[100dvh] w-full max-w-md px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))]">
      <header className="flex h-12 items-center justify-between">
        <Wordmark />
        <Link href="/proof" className="text-[13px] font-medium text-ink-3">
          Live proof
        </Link>
      </header>
      {children}
    </div>
  );
}

function Headline({ order, agentName, waitingChain }: { order: Order; agentName: string; waitingChain: boolean }) {
  const payout = f.ngn(order.payoutNgn ?? order.ngn);
  const cash = order.mode === 'cash';
  const map: Record<string, [string, string]> = {
    awaiting_payment: waitingChain ? ['Confirming payment…', `Checking the Nimiq blockchain for ${order.memo}`] : [`Send ${f.nim(order.nim)}`, `to ${agentName} · you receive ${payout}`],
    expired: ['Quote expired', 'Nothing was taken from your wallet.'],
    paid:
      order.kind === 'cashout'
        ? cash
          ? ['Collect your cash', `Payment verified on-chain. ${agentName} has ${payout} ready.`]
          : [`${payout} on the way`, `Payment verified on-chain. ${agentName} is sending it now.`]
        : [`${f.nim(order.tx?.nim ?? order.nim)} arrived`, 'Verified on the Nimiq blockchain.'],
    payout_sent: [`${payout} sent`, `${agentName} marked it as paid${order.payoutRef ? ` · ref ${order.payoutRef}` : ''}.`],
    completed: [
      'All done',
      order.resolution === 'refunded'
        ? `NimPoint refunded you from ${agentName}'s bond.`
        : order.resolution === 'agent_paid'
          ? `NimPoint checked this order: ${agentName} paid ${payout}.`
          : order.autoCompleted
            ? 'Closed automatically: no problem was reported in time.'
            : order.kind === 'cashout'
              ? `${payout} received. Thanks for using NimPoint.`
              : `${f.nim(order.tx?.nim ?? order.nim)} received.`,
    ],
    disputed: ['We’re on it', `${agentName} has been alerted and will reach out. Your payment is recorded on-chain.`],
    awaiting_fiat: cash ? [`Hand over ${f.ngn(order.ngn)}`, `at ${agentName}`] : [`Send ${f.ngn(order.ngn)}`, `to ${agentName}'s account below`],
    fiat_sent: ['Waiting for the agent', `${agentName} is checking your payment, then sends ${f.nim(order.nim)}.`],
  };
  const [title, sub] = map[order.status];
  return (
    <div className="mt-2 flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <h1 className="text-[32px] font-semibold leading-[1.05] tracking-[-0.035em]">{title}</h1>
        <p className="mt-1.5 text-[15px] leading-snug text-ink-2">{sub}</p>
      </div>
      {order.status === 'completed' && <CoinStage spin className="h-24 w-24 shrink-0" />}
    </div>
  );
}

function RateCard({ order, agentName, onDone }: { order: Order; agentName: string; onDone: (v: OrderView) => void }) {
  const [stars, setStars] = useState(order.rating ?? 0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (order.rating)
    return (
      <Card className="flex items-center justify-between p-5">
        <span className="text-[15px] text-ink-2">You rated {agentName}</span>
        <Stars value={order.rating} size="sm" />
      </Card>
    );
  return (
    <Card className="p-5">
      <p className="text-[17px] font-semibold tracking-[-0.01em]">How was {agentName}?</p>
      <p className="text-[14px] text-ink-3">Your rating helps others pick a NimPoint.</p>
      <div className="mt-3">
        <Stars value={stars} onChange={setStars} />
      </div>
      <AnimatePresence>
        {stars > 0 && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} className="overflow-hidden">
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value.slice(0, 280))}
              placeholder="Anything to add? (optional)"
              rows={2}
              className="mt-3 w-full resize-none rounded-2xl border border-line bg-paper/50 p-3 text-[16px] outline-none focus:border-ink"
            />
            {err && <p className="mt-2 text-[13px] text-danger">{err}</p>}
            <Button
              size="md"
              className="mt-3 w-full"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                setErr(null);
                try {
                  onDone(await orderAction(order.id, { action: 'rate', stars, comment: comment || undefined }));
                } catch (e) {
                  setErr((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Submit rating
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}

function Receipt({ order, agentName }: { order: Order; agentName: string }) {
  const rows: [string, React.ReactNode][] = [
    ['Type', order.kind === 'cashout' ? `Cash out · ${order.mode === 'bank' ? 'bank transfer' : 'cash pickup'}` : `Top up · ${order.mode === 'bank' ? 'bank transfer' : 'cash'}`],
    ['NimPoint', agentName],
    ['Naira', f.ngn(order.payoutNgn ?? order.ngn)],
    ['NIM', f.nim(order.tx?.nim ?? order.nim)],
    ['Rate', `1 NIM = ${f.rate(order.rate)}`],
    ['Memo', <span key="m" className="font-mono">{order.memo}</span>],
  ];
  if (order.bank) rows.push(['Paid to', `${order.bank.accountName} · ${order.bank.bankName} ${order.bank.accountNumber}`]);
  if (order.tx)
    rows.push([
      'Transaction',
      <a key="t" href={EXPLORER_TX(order.tx.hash, order.network)} target="_blank" rel="noreferrer" className="font-mono text-ink underline underline-offset-2">
        {order.tx.hash.slice(0, 8)}…{order.tx.hash.slice(-6)}
      </a>,
    ]);
  if (order.receipt) rows.push(['Receipt', order.receipt.verified ? 'Signed by your wallet ✓' : 'Confirmed']);
  return (
    <Card className="px-5 py-2">
      <dl className="divide-y divide-line/70 text-[14px]">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 py-2.5">
            <dt className="shrink-0 text-ink-3">{k}</dt>
            <dd className="min-w-0 truncate text-right font-medium">{v}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function DisputeForm({ telegram, busy, onSubmit }: { telegram?: string; busy: boolean; onSubmit: (note: string) => void }) {
  const [note, setNote] = useState('');
  return (
    <div className="space-y-3">
      <p className="text-[15px] leading-snug text-ink-2">Bank transfers sometimes take a few extra minutes. If it&apos;s been more than 15 minutes, tell the agent. Your payment is already recorded on-chain.</p>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value.slice(0, 280))}
        placeholder="What happened? (optional)"
        rows={3}
        className="w-full resize-none rounded-2xl border border-line bg-paper/50 p-3 text-[16px] outline-none focus:border-ink"
      />
      <Button variant="danger" className="w-full" loading={busy} onClick={() => onSubmit(note)}>
        Report to agent
      </Button>
      {telegram && (
        <a href={`https://t.me/${telegram.replace(/^@/, '')}`} target="_blank" rel="noreferrer" className="flex h-12 items-center justify-center rounded-full border border-line text-[15px] font-medium">
          Message on Telegram
        </a>
      )}
    </div>
  );
}

function fmtCountdown(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
