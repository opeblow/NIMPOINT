# Security Policy

NimPoint moves real money, so we take security reports seriously.

## Reporting a vulnerability

**Do not open a public issue.** Use GitHub's [private vulnerability reporting](../../security/advisories/new) for this repository. Include:

- what the problem is and its impact,
- steps to reproduce,
- any order IDs involved (never private keys or full bank details).

We aim to acknowledge within 48 hours and ship a fix for critical issues within 7 days.

## Design guarantees

| Area | How NimPoint protects it |
| --- | --- |
| Custody | NimPoint never holds funds. Every NIM payment goes wallet-to-wallet through Nimiq Pay, approved by the user. |
| Payment verification | The server never trusts the client. Payments are matched on-chain by recipient, memo and amount. |
| Replay | A transaction hash can settle exactly one order (atomic `SET NX` lock). |
| Short payments | Payout is recalculated from the NIM actually received, at the locked rate. |
| Double taps | Order creation is rate-limited per wallet. Payment buttons are hidden while a payment is pending. |
| Agent console | Protected by a per-agent secret key sent in a header. Keys live only in server env vars. |
| Telegram webhook | Verified with Telegram's secret token header; button actions also check the agent's chat ID. |
| Data exposure | Account numbers are masked on every public endpoint and shown in full only to the paying agent. |
| Secrets | No keys in the repo. All configuration comes from environment variables (see `.env.example`). |
| Storage | Production refuses to take orders without a persistent database, so no order is silently lost. |

## Supported versions

Only the latest `main` branch, deployed at the production URL, is supported.
