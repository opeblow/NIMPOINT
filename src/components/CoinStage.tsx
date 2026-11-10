'use client';

import dynamic from 'next/dynamic';
import { Component, type ReactNode, useEffect, useState } from 'react';

const Coin3D = dynamic(() => import('./Coin3D'), { ssr: false, loading: () => <CoinFallback /> });

/** Flat coin used before WebGL loads, or if the device can't run it. */
export function CoinFallback() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <svg viewBox="0 0 64 64" className="h-[46%] drop-shadow-[0_18px_22px_rgba(91,67,0,0.28)]" aria-hidden>
        <defs>
          <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#f7d564" />
            <stop offset="0.55" stopColor="#e9b213" />
            <stop offset="1" stopColor="#b07c00" />
          </linearGradient>
        </defs>
        <circle cx="32" cy="32" r="30" fill="url(#g)" />
        <circle cx="32" cy="32" r="26.5" fill="none" stroke="#f7d564" strokeWidth="1.5" />
        <path d="M32 14c-7 0-12.5 5.4-12.5 12.2C19.5 35.4 32 46 32 46s12.5-10.6 12.5-19.8C44.5 19.4 39 14 32 14Z" fill="#f7d564" />
        <circle cx="32" cy="26.5" r="6.5" fill="#c99200" />
        <path d="M27.5 24.8h9M27.5 28.2h9" stroke="#f7d564" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </div>
  );
}

class Guard extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <CoinFallback /> : this.props.children;
  }
}

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

export default function CoinStage({ spin = false, className = '' }: { spin?: boolean; className?: string }) {
  const [gl, setGl] = useState<boolean | null>(null);
  useEffect(() => setGl(webglAvailable()), []);
  return (
    <div className={className} aria-hidden>
      {gl ? (
        <Guard>
          <Coin3D spin={spin} />
        </Guard>
      ) : (
        <CoinFallback />
      )}
    </div>
  );
}
