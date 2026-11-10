'use client';

import { AnimatePresence, motion, type HTMLMotionProps } from 'motion/react';
import Link from 'next/link';
import { LogoMark } from './Logo';
import { type ReactNode, useEffect, useState } from 'react';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
export { cx };

export function Wordmark({ className = '', href = '/app' }: { className?: string; href?: string }) {
  return (
    <Link href={href} className={cx('flex items-center gap-2', className)} aria-label="NimPoint home">
      <LogoMark />
      <span className="text-[17px] font-semibold tracking-[-0.02em]">
        Nim<span className="font-serif text-[20px] font-normal italic tracking-normal">Point</span>
      </span>
    </Link>
  );
}

type ButtonProps = HTMLMotionProps<'button'> & {
  variant?: 'primary' | 'gold' | 'ghost' | 'quiet' | 'danger';
  size?: 'lg' | 'md' | 'sm';
  loading?: boolean;
};

export function Button({ variant = 'primary', size = 'lg', loading, disabled, className, children, ...rest }: ButtonProps) {
  return (
    <motion.button
      whileTap={disabled || loading ? undefined : { scale: 0.97 }}
      disabled={disabled || loading}
      className={cx(
        'relative inline-flex select-none items-center justify-center gap-2 rounded-full font-medium transition-colors disabled:cursor-not-allowed',
        size === 'lg' && 'h-14 px-6 text-[16px]',
        size === 'md' && 'h-11 px-5 text-[15px]',
        size === 'sm' && 'h-9 px-4 text-[14px]',
        variant === 'primary' && 'bg-ink text-paper disabled:bg-ink/25 disabled:text-paper/90',
        variant === 'gold' && 'bg-gold text-ink disabled:opacity-40',
        variant === 'ghost' && 'border border-line bg-card text-ink disabled:opacity-40',
        variant === 'quiet' && 'text-ink-2 hover:text-ink disabled:opacity-40',
        variant === 'danger' && 'border border-danger/30 bg-danger-soft text-danger',
        className,
      )}
      {...rest}
    >
      <span className={cx('inline-flex items-center gap-2', loading && 'opacity-0')}>{children as ReactNode}</span>
      {loading && (
        <span className="absolute inset-0 flex items-center justify-center">
          <Spinner />
        </span>
      )}
    </motion.button>
  );
}

export function Spinner({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={cx('animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-label="Loading">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('rounded-[var(--radius-card)] border border-line/70 bg-card shadow-[var(--shadow-card)]', className)}>{children}</div>;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  id,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  id: string;
}) {
  return (
    <div className="relative grid rounded-full bg-paper-2 p-1" style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx('relative z-10 h-10 rounded-full text-[15px] font-medium transition-colors', value === o.value ? 'text-ink' : 'text-ink-3')}
        >
          {value === o.value && (
            <motion.span
              layoutId={`seg-${id}`}
              className="absolute inset-0 -z-10 rounded-full bg-card shadow-[0_1px_2px_rgba(18,19,15,.08),0_4px_12px_-4px_rgba(18,19,15,.12)]"
              transition={{ type: 'spring', stiffness: 500, damping: 38 }}
            />
          )}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-ink/30 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal
            aria-label={title}
            className="fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[88dvh] w-full max-w-md overflow-y-auto rounded-t-[28px] bg-card px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 shadow-[var(--shadow-lift)]"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 40 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, i) => (i.offset.y > 120 || i.velocity.y > 600) && onClose()}
          >
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-line" />
            {title && <h2 className="mb-4 text-[20px] font-semibold tracking-[-0.02em]">{title}</h2>}
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export function CopyField({ label, value, display, mono = true }: { label: string; value: string; display?: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const t = document.createElement('textarea');
      t.value = value;
      document.body.appendChild(t);
      t.select();
      document.execCommand('copy');
      t.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  return (
    <button onClick={copy} className="flex w-full items-center justify-between gap-3 py-3 text-left">
      <span className="min-w-0">
        <span className="block text-[13px] text-ink-3">{label}</span>
        <span className={cx('block truncate text-[16px] text-ink', mono && 'font-mono tabular')}>{display ?? value}</span>
      </span>
      <span className={cx('shrink-0 rounded-full px-3 py-1 text-[13px] font-medium transition-colors', copied ? 'bg-naira-soft text-naira' : 'bg-paper-2 text-ink-2')}>
        {copied ? 'Copied' : 'Copy'}
      </span>
    </button>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'error' | 'ok'; children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      role={tone === 'error' ? 'alert' : 'status'}
      className={cx(
        'rounded-2xl px-4 py-3 text-[14px] leading-snug',
        tone === 'info' && 'bg-paper-2 text-ink-2',
        tone === 'warn' && 'bg-gold-soft text-gold-deep',
        tone === 'error' && 'bg-danger-soft text-danger',
        tone === 'ok' && 'bg-naira-soft text-naira',
      )}
    >
      {children}
    </motion.div>
  );
}

export function Stars({ value, onChange, size = 'lg' }: { value: number; onChange?: (n: number) => void; size?: 'lg' | 'sm' }) {
  return (
    <div className="flex gap-1" role={onChange ? 'radiogroup' : undefined} aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <motion.button
          key={n}
          type="button"
          disabled={!onChange}
          whileTap={onChange ? { scale: 0.8 } : undefined}
          onClick={() => onChange?.(n)}
          aria-label={`${n} star${n > 1 ? 's' : ''}`}
          className={cx(size === 'lg' ? 'h-11 w-11' : 'h-4 w-4', 'disabled:cursor-default')}
        >
          <svg viewBox="0 0 24 24" className="h-full w-full">
            <path
              d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z"
              fill={n <= value ? '#e9b213' : 'none'}
              stroke={n <= value ? '#c98f00' : '#c9c4b6'}
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          </svg>
        </motion.button>
      ))}
    </div>
  );
}

/** Animated number: each digit rolls independently, like a mechanical counter. */
export function RollingNumber({ text, className }: { text: string; className?: string }) {
  return (
    <span className={cx('inline-flex overflow-hidden tabular', className)} aria-label={text}>
      <AnimatePresence initial={false} mode="popLayout">
        {text.split('').map((ch, i) => (
          <motion.span
            key={`${i}-${ch}-${text.length}`}
            initial={{ y: '60%', opacity: 0, filter: 'blur(4px)' }}
            animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
            exit={{ y: '-60%', opacity: 0, filter: 'blur(4px)' }}
            transition={{ type: 'spring', stiffness: 520, damping: 34 }}
            className="inline-block"
            aria-hidden
          >
            {ch}
          </motion.span>
        ))}
      </AnimatePresence>
    </span>
  );
}
