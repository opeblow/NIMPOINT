'use client';

import { QRCodeSVG } from 'qrcode.react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import * as f from '@/lib/format';
import { agentKey, rememberAgentKey } from '@/lib/local';
import { payWithMemo, walletErrorMessage } from '@/lib/nimiq-client';
import type { Order, PublicAgent } from '@/lib/types';
import { StatusPill } from '@/components/StatusPill';
import { Button, Card, CopyField, cx, Notice, Sheet, Spinner, Stars, Wordmark } from '@/components/ui';

interface Dash {
  agent: PublicAgent;
  orders: Order[];
}

const needsAgent = (o: Order) => (o.kind === 'cashout' && o.status === 'paid') || (o.kind === 'topup' && ['fiat_sent', 'awaiting_fiat', 'disputed'].includes(o.status) && !o.tx);
const isOpen = (o: Order) => !needsAgent(o) && !['completed', 'expired'].includes(o.status);

export default function AgentConsole() {
  const [key, setKey] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [dash, setDash] = useState<Dash | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);

  const load = useCallback(async (k: string) => {
    try {
      setDash(await api<Dash>('/api/agent', { agentKey: k }));
      setErr(null);
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        rememberAgentKey(null);
        setKey(null);
        setDash(null);
      }
      setErr((e as Error).message);
      return false;
    }
  }, []);

  useEffect(() => {
    const k = agentKey();
    setKey(k);
    setReady(true);
    if (k) void load(k);
  }, [load]);

  useEffect(() => {
    if (!key) return;
    const t = setInterval(() => load(key), 5000);
    return () => clearInterval(t);
  }, [key, load]);

  if (!ready) return null;

  if (!key || !dash)
    return (
      <Shell>
        <h1 className="mt-8 text-[30px] font-semibold leading-[1.05] tracking-[-0.035em]">
          NimPoint <span className="font-serif font-normal italic">agent console</span>
        </h1>
        <p className="mt-2 text-[15px] leading-snug text-ink-2">Run a POS stand or have spare Naira? Earn a spread on every NIM cash-out and top-up. Message us to become a NimPoint.</p>
        {key && !dash && !err ? (
          <div className="mt-10 flex justify-center text-ink-3">
            <Spinner className="h-6 w-6" />
          </div>
        ) : (
          <form
            className="mt-8 space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const k = input.trim();
              if (!k) return;
              if (await load(k)) {
                rememberAgentKey(k);
                setKey(k);
              }
            }}
          >
            <input
              type="password"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Agent key"
              autoComplete="current-password"
              className="h-14 w-full rounded-2xl border border-line bg-card px-4 text-[16px] outline-none focus:border-ink"
            />
            {err && <Notice tone="error">{err}</Notice>}
            <Button className="w-full" type="submit">
              Open console
            </Button>
          </form>
        )}
      </Shell>
    );

  const { agent, orders } = dash;
  const todo = orders.filter(needsAgent);
  const open = orders.filter(isOpen);
  const done = orders.filter((o) => o.status === 'completed').slice(0, 15);

  return (
    <Shell>
      <section className="mt-4 rounded-[28px] bg-ink p-5 text-paper">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[13px] text-paper/60">{agent.area}</p>
            <p className="text-[22px] font-semibold tracking-[-0.02em]">{agent.name}</p>
          </div>
          <OnlineSwitch
            online={agent.online}
            onChange={async (v) => {
              await api('/api/agent', { method: 'POST', agentKey: key, json: { action: 'online', online: v } }).catch(() => undefined);
              void load(key);
            }}
          />
        </div>
        <div className="mt-5 grid grid-cols-3 gap-3 text-[13px]">
          <div>
            <p className="text-paper/60">Completed</p>
            <p className="text-[20px] font-semibold tabular">{agent.stats.completed}</p>
          </div>
          <div>
            <p className="text-paper/60">Rating</p>
            <p className="text-[20px] font-semibold tabular">{agent.stats.ratingAvg ? agent.stats.ratingAvg.toFixed(1) : '—'}</p>
          </div>
          <div>
            <p className="text-paper/60">Median payout</p>
            <p className="text-[20px] font-semibold tabular">{agent.stats.medianPayoutMins !== null ? `${Math.max(1, Math.round(agent.stats.medianPayoutMins))}m` : '—'}</p>
          </div>
        </div>
        <button onClick={() => setQrOpen(true)} className="mt-5 flex h-11 w-full items-center justify-center rounded-full bg-gold text-[15px] font-medium text-ink">
          Show my NimPoint QR
        </button>
      </section>

      {err && (
        <div className="mt-4">
          <Notice tone="warn">{err}</Notice>
        </div>
      )}

      <Section title={`Needs you${todo.length ? ` · ${todo.length}` : ''}`}>
        {todo.length === 0 ? <Empty>Nothing to do. New orders appear here instantly.</Empty> : todo.map((o) => <TodoCard key={o.id} order={o} agentKey={key} onChange={() => load(key)} />)}
      </Section>

      {open.length > 0 && (
        <Section title="In progress">
          <Card className="divide-y divide-line/70">
            {open.map((o) => (
              <Line key={o.id} order={o} />
            ))}
          </Card>
        </Section>
      )}

      <Section title="Completed">
        {done.length === 0 ? (
          <Empty>No completed orders yet.</Empty>
        ) : (
          <Card className="divide-y divide-line/70">
            {done.map((o) => (
              <Line key={o.id} order={o} />
            ))}
          </Card>
        )}
      </Section>

      <button
        className="mt-10 w-full text-center text-[13px] text-ink-3"
        onClick={() => {
          rememberAgentKey(null);
          setKey(null);
          setDash(null);
        }}
      >
        Sign out
      </button>

      <Sheet open={qrOpen} onClose={() => setQrOpen(false)} title="Your NimPoint QR">
        <AgentQr agentId={agent.id} name={agent.name} />
      </Sheet>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto min-h-[100dvh] w-full max-w-md px-4 pb-12 pt-[max(0.75rem,env(safe-area-inset-top))]">
      <header className="flex h-12 items-center justify-between">
        <Wordmark />
        <Link href="/app" className="text-[13px] font-medium text-ink-3">
          Customer app
        </Link>
      </header>
      {children}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-2 px-1 text-[13px] font-medium uppercase tracking-[0.08em] text-ink-3">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => <p className="rounded-[24px] border border-dashed border-line px-4 py-6 text-center text-[14px] text-ink-3">{children}</p>;

function Line({ order: o }: { order: Order }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="text-[15px] font-medium">
          {o.kind === 'cashout' ? 'Cash out' : 'Top up'} · {f.ngn(o.payoutNgn ?? o.ngn)}
        </p>
        <p className="flex items-center gap-2 text-[12px] text-ink-3">
          <span className="font-mono">{o.id}</span> · {f.ago(o.createdAt)}
          {o.rating ? <Stars value={o.rating} size="sm" /> : null}
        </p>
      </div>
      <StatusPill order={o} />
    </div>
  );
}

function TodoCard({ order: o, agentKey: key, onChange }: { order: Order; agentKey: string; onChange: () => void }) {
  const [ref, setRef] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const sentKey = `np:agent-sent:${o.id}`;
  const [sent, setSent] = useState(false);
  useEffect(() => {
    try {
      setSent(Boolean(localStorage.getItem(sentKey)));
    } catch {
      /* ignore */
    }
  }, [sentKey]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      onChange();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : walletErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const payout = o.payoutNgn ?? o.ngn;

  return (
    <Card className={cx('overflow-hidden', o.status === 'disputed' && 'border-danger/40')}>
      <div className="flex items-center justify-between px-5 pt-4">
        <span className="font-mono text-[13px] text-ink-3">#{o.id}</span>
        <StatusPill order={o} />
      </div>
      {o.kind === 'cashout' ? (
        <div className="px-5 pb-5">
          <p className="mt-1 text-[26px] font-semibold tracking-[-0.03em] tabular">Pay {f.ngn(payout)}</p>
          <p className="text-[14px] text-naira">✓ {f.nim(o.tx?.nim ?? o.nim)} received on-chain</p>
          {o.mode === 'bank' && o.bank ? (
            <div className="mt-3 divide-y divide-line/70 rounded-2xl bg-paper-2/60 px-4">
              <CopyField label="Amount" value={String(payout)} display={f.ngn(payout)} />
              <CopyField label="Account number" value={o.bank.accountNumber} />
              <CopyField label={o.bank.bankName} value={o.bank.accountName} mono={false} />
            </div>
          ) : (
            <p className="mt-3 rounded-2xl bg-gold-soft p-3 text-[14px] text-gold-deep">
              Cash pickup. Match the code on the customer&apos;s phone: <b className="font-mono">{o.id.slice(0, 4)} {o.id.slice(4)}</b>
            </p>
          )}
          {o.mode === 'bank' && (
            <input
              value={ref}
              onChange={(e) => setRef(e.target.value.slice(0, 80))}
              placeholder="Transfer reference (optional)"
              className="mt-3 h-11 w-full rounded-xl border border-line bg-card px-3 text-[16px] outline-none focus:border-ink"
            />
          )}
          {err && <p className="mt-2 text-[13px] text-danger">{err}</p>}
          <Button
            size="md"
            className="mt-3 w-full"
            loading={busy}
            onClick={() => act(() => api('/api/agent', { method: 'POST', agentKey: key, json: { action: 'payout_sent', id: o.id, ref: ref || undefined } }))}
          >
            {o.mode === 'bank' ? `I've sent ${f.ngn(payout)}` : `I've handed over ${f.ngn(payout)}`}
          </Button>
        </div>
      ) : (
        <div className="px-5 pb-5">
          <p className="mt-1 text-[26px] font-semibold tracking-[-0.03em] tabular">Send {f.nim(o.nim)}</p>
          <p className="text-[14px] text-ink-2">
            {o.status === 'awaiting_fiat' ? 'Customer has not marked payment yet. ' : 'Customer says they paid. '}
            Check you received <b>{f.ngn(o.ngn)}</b> {o.mode === 'bank' ? `with reference ${o.id}` : 'in cash'} first.
          </p>
          <p className="mt-2 font-mono text-[12px] text-ink-3">To {f.shortAddress(o.wallet)}</p>
          {err && <p className="mt-2 text-[13px] text-danger">{err}</p>}
          {sent ? (
            <p className="mt-3 flex items-center gap-2 rounded-2xl bg-paper-2 p-3 text-[14px] text-ink-2">
              <Spinner className="h-4 w-4" /> Sent. Waiting for the chain to confirm…
            </p>
          ) : (
            <Button
              size="md"
              variant="gold"
              className="mt-3 w-full"
              loading={busy}
              onClick={() =>
                act(async () => {
                  const hash = await payWithMemo(o.wallet, o.nim, o.memo);
                  try {
                    localStorage.setItem(sentKey, '1');
                  } catch {
                    /* ignore */
                  }
                  setSent(true);
                  await api('/api/agent', { method: 'POST', agentKey: key, json: { action: 'nim_sent', id: o.id, hash: String(hash) } });
                })
              }
            >
              Send {f.nim(o.nim)} with Nimiq Pay
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

function OnlineSwitch({ online, onChange }: { online: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={online}
      onClick={() => onChange(!online)}
      className={cx('flex h-9 items-center gap-2 rounded-full pl-1 pr-3 text-[13px] font-medium transition-colors', online ? 'bg-naira text-white' : 'bg-paper/15 text-paper/70')}
    >
      <span className={cx('h-7 w-7 rounded-full transition-colors', online ? 'bg-white' : 'bg-paper/40')} />
      {online ? 'Online' : 'Offline'}
    </button>
  );
}

function AgentQr({ agentId, name }: { agentId: string; name: string }) {
  const [url, setUrl] = useState('');
  useEffect(() => setUrl(`https://nimpay.app/miniapps/open/${window.location.host}/app?agent=${agentId}&mode=cash`), [agentId]);
  return (
    <div className="text-center">
      <div className="mx-auto w-fit rounded-[28px] border border-line bg-white p-5">
        {url && <QRCodeSVG value={url} size={220} fgColor="#12130f" level="M" />}
        <p className="mt-3 text-[18px] font-semibold tracking-[-0.02em]">{name}</p>
        <p className="text-[14px] text-ink-2">Scan to cash out NIM here</p>
      </div>
      <p className="mt-4 text-[14px] leading-snug text-ink-3">Print it and stick it on your stand. Customers scan it with their phone camera and land straight in your NimPoint.</p>
      <Button variant="ghost" size="md" className="mt-4" onClick={() => window.print()}>
        Print poster
      </Button>
    </div>
  );
}
