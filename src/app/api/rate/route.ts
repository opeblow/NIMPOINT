import { getQuote } from '@/lib/rates';
import { handle, ok } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return ok(await getQuote());
  } catch (err) {
    return handle(err);
  }
}
