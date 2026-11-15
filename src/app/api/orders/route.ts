import { z } from 'zod';
import { autoComplete, createOrder, ordersForWallet, ownerOrder, publicOrder } from '@/lib/orders';
import { handle, ok } from '@/lib/http';
import { bankName } from '@/lib/banks';

export const dynamic = 'force-dynamic';

const nimiqAddress = z
  .string()
  .transform((s) => s.replace(/\s+/g, '').toUpperCase())
  .refine((s) => /^NQ[0-9]{2}[0-9A-Z]{32}$/.test(s), 'That Nimiq address looks wrong.');

const CreateSchema = z.object({
  kind: z.enum(['cashout', 'topup']),
  mode: z.enum(['bank', 'cash']),
  agentId: z.string().min(1),
  wallet: nimiqAddress,
  ngn: z.number().int().positive(),
  network: z.enum(['mainnet', 'testnet']).default('mainnet'),
  bank: z
    .object({
      bankCode: z.string().min(3),
      accountNumber: z.string().regex(/^\d{10}$/, 'Account number should be 10 digits.'),
      accountName: z.string().trim().min(3, 'Add the name on the account.').max(80),
    })
    .optional(),
  idempotencyKey: z
    .string()
    .regex(/^[A-Za-z0-9_-]{8,64}$/)
    .optional(),
});

export async function POST(req: Request) {
  try {
    const body = CreateSchema.parse(await req.json());
    const bank = body.bank
      ? { ...body.bank, bankName: bankName(body.bank.bankCode) ?? 'Bank' }
      : undefined;
    const order = await createOrder({ ...body, bank });
    // The creator gets the order secret once; it unlocks confirm, rate, dispute and the pickup code.
    return ok({ order: { ...ownerOrder(order), secret: order.secret } });
  } catch (err) {
    return handle(err);
  }
}

export async function GET(req: Request) {
  try {
    const wallet = nimiqAddress.parse(new URL(req.url).searchParams.get('wallet') ?? '');
    const orders = await Promise.all((await ordersForWallet(wallet)).map(autoComplete));
    // Anyone can type a wallet address here, so this list never carries bank details, even masked.
    // The order's own page shows them to the phone that made it.
    return ok({ orders: orders.map((o) => ({ ...publicOrder(o), bank: undefined })) });
  } catch (err) {
    return handle(err);
  }
}
