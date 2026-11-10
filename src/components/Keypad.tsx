'use client';

import { motion } from 'motion/react';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', 'del'] as const;

/** Big-thumb keypad. Avoids the system keyboard covering half the webview. */
export function Keypad({ onKey }: { onKey: (k: (typeof KEYS)[number]) => void }) {
  return (
    <div className="grid grid-cols-3 gap-1">
      {KEYS.map((k) => (
        <motion.button
          key={k}
          type="button"
          whileTap={{ scale: 0.9, backgroundColor: 'rgba(18,19,15,0.07)' }}
          transition={{ duration: 0.08 }}
          onClick={() => {
            try {
              navigator.vibrate?.(6);
            } catch {
              /* not supported */
            }
            onKey(k);
          }}
          aria-label={k === 'del' ? 'Delete' : k}
          className="flex h-[clamp(42px,6.6dvh,54px)] items-center justify-center rounded-2xl text-[24px] font-medium text-ink tabular"
        >
          {k === 'del' ? (
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1Z" />
              <path d="m16 9-5 6M11 9l5 6" />
            </svg>
          ) : (
            k
          )}
        </motion.button>
      ))}
    </div>
  );
}

export type KeypadKey = (typeof KEYS)[number];

export function applyKey(current: string, k: KeypadKey, max: number) {
  if (k === 'del') return current.slice(0, -1);
  const next = (current === '0' ? '' : current) + k;
  if (Number(next) > max * 10) return current;
  return next.replace(/^0+/, '') || '';
}
