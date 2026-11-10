import { publicAgents } from '@/lib/orders';
import { handle, ok } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return ok({ agents: await publicAgents() });
  } catch (err) {
    return handle(err);
  }
}
