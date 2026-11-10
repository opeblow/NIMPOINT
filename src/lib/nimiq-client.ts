'use client';

import { useCallback, useEffect, useState } from 'react';
import { getHostNetwork, init, NimiqProviderError, type NimiqProvider } from '@nimiq/mini-app-sdk';
import { LUNA_PER_NIM } from './config';

export type WalletStatus = 'connecting' | 'ready' | 'outside' | 'denied';

let providerPromise: Promise<NimiqProvider | null> | null = null;

/** One shared provider. Resolves to null when not running inside Nimiq Pay. */
export function getProvider() {
  if (typeof window === 'undefined') return Promise.resolve(null);
  providerPromise ??= init({ timeout: 4000 }).catch(() => null);
  return providerPromise;
}

export interface WalletState {
  status: WalletStatus;
  address: string | null;
  /** Spendable NIM (wallet + current HTLC), or null if unknown. */
  balance: number | null;
  network: string | undefined;
  refresh: () => Promise<void>;
}

async function readBalance(p: NimiqProvider, accounts: string[]) {
  if (typeof p.getBalance !== 'function') return null;
  const all = await Promise.all(accounts.map((a) => p.getBalance(a).catch(() => 0)));
  return all.reduce((s, b) => s + b, 0) / LUNA_PER_NIM;
}

export function useWallet(): WalletState {
  const [status, setStatus] = useState<WalletStatus>('connecting');
  const [address, setAddress] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);

  const load = useCallback(async () => {
    const p = await getProvider();
    if (!p) {
      setStatus('outside');
      return;
    }
    try {
      const accounts = await p.listAccounts();
      setAddress(accounts[0] ?? null);
      setStatus('ready');
      setBalance(await readBalance(p, accounts).catch(() => null));
    } catch (err) {
      setStatus(NimiqProviderError.is(err) ? 'denied' : 'outside');
    }
  }, []);

  useEffect(() => {
    void load();
    let off: (() => void) | undefined;
    void getProvider().then((p) => {
      if (!p) return;
      const onChange = (accounts: string[]) => {
        setAddress(accounts[0] ?? null);
        void readBalance(p, accounts).then(setBalance).catch(() => undefined);
      };
      p.on('accountsChanged', onChange);
      off = () => p.removeListener('accountsChanged', onChange);
    });
    return () => off?.();
  }, [load]);

  return { status, address, balance, network: typeof window !== 'undefined' ? getHostNetwork() : undefined, refresh: load };
}

/** Friendly text for anything Nimiq Pay can throw at us. */
export function walletErrorMessage(err: unknown) {
  if (NimiqProviderError.is(err)) {
    const t = err.type.toUpperCase();
    if (t.includes('REJECT') || t.includes('DENIED') || t.includes('CANCEL')) return 'You cancelled in Nimiq Pay. Nothing was sent.';
    if (t.includes('INSUFFICIENT') || t.includes('BALANCE')) return "Your balance isn't enough for this payment.";
    if (t.includes('OUTCOME_UNKNOWN')) return "Nimiq Pay isn't sure the payment went through. Don't pay again: we'll check the chain for you.";
    return err.message || 'Nimiq Pay could not complete the payment.';
  }
  return (err as Error)?.message || 'Nimiq Pay could not complete the payment.';
}

const NOT_IN_NIMIQ_PAY = 'Open NimPoint inside Nimiq Pay to pay.';

/** True only when Nimiq Pay is certain no NIM left the wallet. Anything else might have been sent. */
export function definitelyNotSent(err: unknown) {
  if (NimiqProviderError.is(err)) {
    const t = err.type.toUpperCase();
    return ['REJECT', 'DENIED', 'CANCEL', 'INSUFFICIENT', 'BALANCE'].some((w) => t.includes(w));
  }
  return (err as Error)?.message === NOT_IN_NIMIQ_PAY;
}

/** Ask Nimiq Pay to send NIM with our order memo. Returns whatever the host returns (hash or serialized tx). */
export async function payWithMemo(recipient: string, nim: number, memo: string) {
  const p = await getProvider();
  if (!p) throw new Error(NOT_IN_NIMIQ_PAY);
  return p.sendBasicTransactionWithData({
    recipient: recipient.replace(/\s+/g, ''),
    value: Math.round(nim * LUNA_PER_NIM),
    data: memo,
  });
}

/** Optional: the user signs a one-line receipt with their wallet key. */
export async function signReceipt(message: string) {
  const p = await getProvider();
  if (!p) return undefined;
  const r = await p.sign(message);
  return { message, publicKey: r.publicKey, signature: r.signature };
}

export function nimiqPayLink() {
  if (typeof window === 'undefined') return 'https://nimpay.app';
  return `https://nimpay.app/miniapps/open/${window.location.host}${window.location.pathname}${window.location.search}`;
}
