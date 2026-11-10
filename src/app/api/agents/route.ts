import { asNetwork } from '@/lib/config';
import { publicAgents } from '@/lib/orders';
import { handle, ok } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** `?network=testnet` gives each agent's test-network record and bond instead of the real one. */
export async function GET(req: Request) {
  try {
    return ok({ agents: await publicAgents(asNetwork(new URL(req.url).searchParams.get('network'))) });
  } catch (err) {
    return handle(err);
  }
}
