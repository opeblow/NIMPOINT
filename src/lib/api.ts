'use client';

import { orderToken } from './local';
import type { Order, PublicAgent, Quote } from './types';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit & { json?: unknown; agentKey?: string }): Promise<T> {
  const headers: Record<string, string> = {};
  if (init?.json !== undefined) headers['Content-Type'] = 'application/json';
  if (init?.agentKey) headers['x-agent-key'] = init.agentKey;
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { ...headers, ...(init?.headers as Record<string, string>) },
      body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
      cache: 'no-store',
    });
  } catch {
    throw new ApiError("You seem to be offline. Check your connection and try again.", 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? 'Something went wrong. Please try again.', res.status);
  return data as T;
}

export interface OrderView {
  order: Order;
  agent: PublicAgent | null;
  agentBank: { bankName: string; accountNumber: string; accountName: string } | null;
  /** This phone made the order: it sees full details and the pickup code. */
  mine?: boolean;
}

const tokenHeader = (id: string) => {
  const token = orderToken(id);
  return token ? { 'x-order-token': token } : undefined;
};

export const fetchQuote = () => api<Quote>('/api/rate');
export const fetchAgents = (network: 'mainnet' | 'testnet' = 'mainnet') => api<{ agents: PublicAgent[] }>(`/api/agents?network=${network}`);
export const fetchOrder = (id: string) => api<OrderView>(`/api/orders/${id}`, { headers: tokenHeader(id) });
export const orderAction = (id: string, json: Record<string, unknown>) =>
  api<OrderView>(`/api/orders/${id}`, { method: 'POST', json, headers: tokenHeader(id) });
