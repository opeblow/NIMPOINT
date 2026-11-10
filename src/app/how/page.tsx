import Link from 'next/link';
import { Wordmark } from '@/components/ui';
import { LIMITS } from '@/lib/config';

export const metadata = { title: 'How NimPoint works' };

const steps = [
  ['Enter an amount', 'Type how much Naira you want. You see the live rate and exactly how much NIM it takes.'],
  ['Pick bank or cash', 'Get Naira in any Nigerian bank account, or collect cash from a NimPoint agent, like a POS stand.'],
  ['Pay from Nimiq Pay', 'Your NIM goes straight from your wallet to the agent, with your order code as the memo. One tap.'],
  ['Verified on-chain', 'NimPoint finds your payment on the Nimiq blockchain within seconds and alerts the agent.'],
  ['Get your Naira', 'The agent pays out. You confirm and rate them, so the best agents rise to the top.'],
];

export default function How() {
  return (
    <div className="mx-auto min-h-[100dvh] w-full max-w-md px-4 pb-12 pt-[max(0.75rem,env(safe-area-inset-top))]">
      <header className="flex h-12 items-center justify-between">
        <Wordmark />
        <Link href="/app" className="text-[14px] font-medium text-ink-2">
          Open app
        </Link>
      </header>

      <h1 className="mt-6 text-[34px] font-semibold leading-[1.04] tracking-[-0.04em]">
        Every POS stand,
        <br />
        <span className="font-serif font-normal italic">a NIM cash point.</span>
      </h1>
      <p className="mt-3 text-[16px] leading-snug text-ink-2">
        Nimiq Pay has no way to cash out or top up. In Lagos, people already trust POS agents with cash every day. NimPoint connects the two.
      </p>

      <ol className="mt-8 space-y-5">
        {steps.map(([t, d], i) => (
          <li key={t} className="flex gap-4">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink text-[14px] font-semibold text-gold">{i + 1}</span>
            <div>
              <p className="text-[17px] font-semibold tracking-[-0.01em]">{t}</p>
              <p className="mt-0.5 text-[15px] leading-snug text-ink-2">{d}</p>
            </div>
          </li>
        ))}
      </ol>

      <section className="mt-10 rounded-[24px] border border-line/70 bg-card p-5">
        <h2 className="text-[17px] font-semibold">Top up works the same way, in reverse</h2>
        <p className="mt-1 text-[15px] leading-snug text-ink-2">Send Naira or hand cash to an agent. They send NIM to your wallet, and NimPoint verifies it on-chain.</p>
      </section>

      <section id="terms" className="mt-10 space-y-3 text-[14px] leading-relaxed text-ink-2">
        <h2 className="text-[17px] font-semibold text-ink">Terms, in plain words</h2>
        <p>
          NimPoint is a peer-to-peer marketplace. It connects you with independent agents. It is <b>not</b> a bank, exchange or custodian, and it never holds your
          funds: every NIM payment goes directly from one wallet to another.
        </p>
        <p>
          Orders are limited to ₦{LIMITS.maxNgn.toLocaleString()} each. Rates are held for 30 minutes. Agents set a small spread (shown before you pay) which is their
          entire fee.
        </p>
        <p>
          We store only what an order needs: your wallet address, amount and, for bank payouts, the account you enter. Account numbers are shown only to the agent
          paying you. Payments are public on the Nimiq blockchain by design.
        </p>
        <p>
          Agents can be asked to lock a bond: NIM they deposit in a public NimPoint bond wallet before taking orders. It limits how much an agent can owe customers at
          one time. If you pay for a cash-out and are not paid, NimPoint can refund you from that agent&apos;s bond. Bonds are the only funds NimPoint holds, and they
          belong to the agents.
        </p>
        <p>
          If something goes wrong, report it from the order page within 24 hours. The agent is alerted immediately and your payment stays on record on-chain. An order
          that is neither confirmed nor reported for 24 hours after the agent pays closes by itself.
        </p>
      </section>
    </div>
  );
}
