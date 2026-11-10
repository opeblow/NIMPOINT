'use client';

import { motion, useAnimationControls } from 'motion/react';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { LogoMark } from './Logo';
import { cx } from './ui';

const PIN_KEY = 'np:pin';
const UNLOCK_KEY = 'np:unlocked';
const LEN = 4;

type Mode = 'checking' | 'create' | 'confirm' | 'unlock' | 'open';

async function hash(pin: string) {
  const data = new TextEncoder().encode(`nimpoint:${pin}`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function storedPin(): string | null | undefined {
  try {
    return localStorage.getItem(PIN_KEY);
  } catch {
    return undefined; // storage blocked: never lock people out
  }
}

export const hasPasscode = () => Boolean(storedPin());

/** Device passcode, like a banking app. Funds stay in Nimiq Pay; this guards the app on a shared phone. */
export function PinGate({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>('checking');
  const [pin, setPin] = useState('');
  const [first, setFirst] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fails, setFails] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const shake = useAnimationControls();

  useEffect(() => {
    const s = storedPin();
    let unlocked = false;
    try {
      unlocked = sessionStorage.getItem(UNLOCK_KEY) === '1';
    } catch {
      unlocked = false;
    }
    if (s === undefined || unlocked || typeof crypto?.subtle === 'undefined') setMode('open');
    else setMode(s ? 'unlock' : 'create');
  }, []);

  useEffect(() => {
    if (lockedUntil <= Date.now()) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [lockedUntil]);

  const open = () => {
    try {
      sessionStorage.setItem(UNLOCK_KEY, '1');
    } catch {
      /* ignore */
    }
    setMode('open');
  };

  const wrong = useCallback(
    async (msg: string) => {
      setError(msg);
      try {
        navigator.vibrate?.([30, 40, 30]);
      } catch {
        /* ignore */
      }
      await shake.start({ x: [0, -12, 12, -8, 8, 0], transition: { duration: 0.35 } });
      setPin('');
    },
    [shake],
  );

  const submit = useCallback(
    async (value: string) => {
      if (mode === 'create') {
        setFirst(value);
        setPin('');
        setMode('confirm');
        return;
      }
      if (mode === 'confirm') {
        if (value !== first) {
          setMode('create');
          setFirst('');
          return wrong("Passcodes didn't match. Try again.");
        }
        try {
          localStorage.setItem(PIN_KEY, await hash(value));
        } catch {
          /* ignore */
        }
        return open();
      }
      if (mode === 'unlock') {
        if ((await hash(value)) === storedPin()) return open();
        const n = fails + 1;
        setFails(n);
        if (n >= 5) {
          setLockedUntil(Date.now() + 30_000);
          setFails(0);
          return wrong('Too many tries. Wait 30 seconds.');
        }
        return wrong(`Wrong passcode. ${5 - n} ${5 - n === 1 ? 'try' : 'tries'} left.`);
      }
    },
    [mode, first, fails, wrong],
  );

  const press = (k: string) => {
    if (lockedUntil > Date.now()) return;
    setError(null);
    if (k === 'del') return setPin((p) => p.slice(0, -1));
    const next = (pin + k).slice(0, LEN);
    setPin(next);
    if (next.length === LEN) setTimeout(() => void submit(next), 120);
  };

  const reset = () => {
    if (!window.confirm('Reset your NimPoint passcode on this device? Your money is safe in Nimiq Pay.')) return;
    try {
      localStorage.removeItem(PIN_KEY);
    } catch {
      /* ignore */
    }
    setPin('');
    setFirst('');
    setError(null);
    setMode('create');
  };

  if (mode === 'open') return <>{children}</>;
  if (mode === 'checking') return <div className="min-h-[100dvh]" />;

  const locked = lockedUntil > now;
  const title = mode === 'create' ? 'Create a passcode' : mode === 'confirm' ? 'Confirm your passcode' : 'Enter your passcode';
  const sub =
    mode === 'unlock' ? 'Unlock NimPoint' : mode === 'create' ? '4 digits to keep NimPoint private on this phone' : 'Type the same 4 digits again';

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col items-center px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(3rem,env(safe-area-inset-top))]">
      <LogoMark className="h-14 w-14" />
      <h1 className="mt-6 text-[26px] font-semibold tracking-[-0.03em]">{title}</h1>
      <p className="mt-1 text-center text-[15px] text-ink-2">{sub}</p>

      <motion.div animate={shake} className="mt-8 flex gap-4" aria-label={`${pin.length} of ${LEN} digits entered`}>
        {Array.from({ length: LEN }, (_, i) => (
          <motion.span
            key={i}
            animate={{ scale: i < pin.length ? 1.15 : 1 }}
            transition={{ type: 'spring', stiffness: 600, damping: 20 }}
            className={cx('h-4 w-4 rounded-full border-2 transition-colors', i < pin.length ? 'border-ink bg-ink' : 'border-ink/25')}
          />
        ))}
      </motion.div>
      <p role="alert" className="mt-4 h-5 text-center text-[14px] text-danger">
        {locked ? `Try again in ${Math.ceil((lockedUntil - now) / 1000)}s` : error}
      </p>

      <div className="flex-1" />
      <div className="grid w-full max-w-[300px] grid-cols-3 gap-3">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'].map((k, i) =>
          k === '' ? (
            <span key={i} />
          ) : (
            <motion.button
              key={k}
              type="button"
              whileTap={{ scale: 0.9, backgroundColor: 'rgba(18,19,15,0.08)' }}
              onClick={() => press(k)}
              disabled={locked}
              aria-label={k === 'del' ? 'Delete' : k}
              className={cx(
                'flex aspect-square items-center justify-center rounded-full text-[28px] font-medium tabular disabled:opacity-40',
                k === 'del' ? '' : 'border border-line/80 bg-card',
              )}
            >
              {k === 'del' ? (
                <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1Z" />
                  <path d="m16 9-5 6M11 9l5 6" />
                </svg>
              ) : (
                k
              )}
            </motion.button>
          ),
        )}
      </div>
      {mode === 'unlock' && (
        <button onClick={reset} className="mt-6 h-10 text-[14px] font-medium text-ink-3">
          Forgot passcode?
        </button>
      )}
      {mode !== 'unlock' && <div className="mt-6 h-10" />}
    </div>
  );
}
