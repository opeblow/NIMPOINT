import 'server-only';
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { OrderError } from './orders';
import { RpcUnavailable } from './nimiq-rpc';

export const ok = <T,>(data: T, init?: ResponseInit) =>
  NextResponse.json(data, { ...init, headers: { 'Cache-Control': 'no-store', ...init?.headers } });

export const fail = (message: string, status = 400) => ok({ error: message }, { status });

/**
 * The caller's IP for rate limits. Vercel sets x-vercel-forwarded-for and x-real-ip itself, so a client can't fake them.
 * Elsewhere, the last x-forwarded-for entry is the one our own proxy added; the first one is whatever the client sent.
 */
export function clientIp(req: Request) {
  const h = req.headers;
  const own = h.get('x-vercel-forwarded-for') ?? h.get('x-real-ip');
  if (own) return own.split(',')[0].trim();
  const chain = (h.get('x-forwarded-for') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return chain[chain.length - 1] ?? 'unknown';
}

/** Turns any thrown error into a short message a person can act on. */
export function handle(err: unknown) {
  if (err instanceof OrderError) return fail(err.message, err.status);
  if (err instanceof ZodError) return fail(err.issues[0]?.message ?? 'Some details are missing.', 422);
  // req.json() on a body that isn't JSON.
  if (err instanceof SyntaxError) return fail("We couldn't read that request. Please try again.", 400);
  if (err instanceof RpcUnavailable) return fail('The Nimiq network is slow to answer. Your order is safe. Try again in a moment.', 503);
  console.error(err);
  return fail('Something went wrong on our side. Your funds are safe. Please try again.', 500);
}
