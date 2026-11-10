'use client';

import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useState } from 'react';
import { nimiqPayLink } from '@/lib/nimiq-client';
import { Card } from './ui';

/** Shown when the page is opened in a normal browser instead of Nimiq Pay. */
export function OpenInNimiqPay({ compact = false }: { compact?: boolean }) {
  const [link, setLink] = useState('https://nimpay.app');
  useEffect(() => setLink(nimiqPayLink()), []);
  return (
    <Card className="p-5">
      <div className="flex items-start gap-4">
        {!compact && (
          <div className="shrink-0 rounded-2xl bg-white p-2">
            <QRCodeSVG value={link} size={92} fgColor="#12130f" bgColor="#ffffff" level="M" />
          </div>
        )}
        <div className="min-w-0">
          <p className="text-[16px] font-semibold tracking-[-0.01em]">Open in Nimiq Pay to continue</p>
          <p className="mt-1 text-[14px] leading-snug text-ink-2">
            NimPoint runs inside the Nimiq Pay wallet, so your NIM never leaves your control. {compact ? '' : 'Scan with your phone, or tap below on mobile.'}
          </p>
          <a href={link} className="mt-3 inline-flex h-10 items-center rounded-full bg-ink px-4 text-[14px] font-medium text-paper">
            Open in Nimiq Pay
          </a>
        </div>
      </div>
    </Card>
  );
}
