export type OrderKind = 'cashout' | 'topup';
export type PayoutMode = 'bank' | 'cash';

/**
 * Cash-out: awaiting_payment → paid → payout_sent → completed
 * Top-up:   awaiting_fiat → fiat_sent → paid → completed
 * Either can end in expired or disputed.
 */
export type OrderStatus =
  | 'awaiting_payment'
  | 'awaiting_fiat'
  | 'fiat_sent'
  | 'paid'
  | 'payout_sent'
  | 'completed'
  | 'expired'
  | 'disputed';

export interface BankAccount {
  bankCode: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
}

export interface OnchainTx {
  hash: string;
  from: string;
  to: string;
  nim: number;
  at: number;
}

export interface OrderEvent {
  status: OrderStatus;
  at: number;
  note?: string;
}

export interface Order {
  id: string;
  kind: OrderKind;
  mode: PayoutMode;
  agentId: string;
  /** User's Nimiq Pay wallet address (first of listAccounts). */
  wallet: string;
  ngn: number;
  nim: number;
  /** NGN per NIM, locked at quote time (already includes the agent's spread). */
  rate: number;
  memo: string;
  /** Cash-out: where the user sends NIM. Top-up: where the agent sends NIM. */
  nimRecipient: string;
  bank?: BankAccount;
  status: OrderStatus;
  createdAt: number;
  expiresAt: number;
  tx?: OnchainTx;
  /** Naira actually owed after on-chain amount is known (covers short payments). */
  payoutNgn?: number;
  payoutRef?: string;
  receipt?: { message: string; publicKey: string; signature: string; verified: boolean };
  rating?: number;
  comment?: string;
  events: OrderEvent[];
  lastSyncAt?: number;
  /** Version for safe concurrent saves. Bumped on every save. */
  v?: number;
  /** More payments that carried this order's memo after it was already paid. Someone owes a refund. */
  extraPayments?: OnchainTx[];
  /** Top-up: when the agent opened Nimiq Pay to send NIM. Blocks a second send. */
  sendStartedAt?: number;
  /** Given only to the order's creator. Needed to confirm, rate or dispute. Never shown publicly. */
  secret?: string;
}

export interface PublicAgent {
  id: string;
  name: string;
  area: string;
  address: string;
  modes: PayoutMode[];
  kinds: OrderKind[];
  cashoutSpreadBps: number;
  topupSpreadBps: number;
  maxNgn: number;
  telegram?: string;
  online: boolean;
  stats: AgentStats;
}

export interface AgentStats {
  completed: number;
  ratingAvg: number | null;
  ratingCount: number;
  medianPayoutMins: number | null;
}

export interface Quote {
  /** Mid-market NGN per NIM. */
  mid: number;
  usd: number;
  updatedAt: number;
  source: string;
}

export interface ProofEntry {
  id: string;
  kind: 'cashout' | 'topup';
  mode: 'bank' | 'cash';
  wallet: string;
  ngn: number;
  nim: number;
  status: string;
  at: number;
  tx: string;
  rating?: number;
}

export interface Proof {
  generatedAt: number;
  ledger: {
    uniqueWallets: number;
    orders: number;
    completed: number;
    volumeNgn: number;
    volumeNim: number;
    ratingAvg: number | null;
    daily: { day: string; orders: number; wallets: number }[];
    entries: ProofEntry[];
  };
  chain: {
    /** Independently counted from agent addresses: every incoming tx with a NIMPOINT memo. */
    memoPayments: number;
    uniqueSenders: number;
    agents: { name: string; address: string }[];
  };
}

