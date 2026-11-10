# Contributing to NimPoint

Thanks for helping bring NIM cash points to more people.

## Setup

```bash
git clone https://github.com/<you>/nimpoint && cd nimpoint
npm install
cp .env.example .env.local   # fill AGENT_ADDRESS and AGENT_KEY at minimum
npm run dev                  # http://localhost:3000
```

Without Redis credentials the app uses an in-memory store, which is fine for development.

## Testing against a fake chain

```bash
npm run mock:nimiq                         # terminal 1: mock Nimiq node on :8648
NIMIQ_RPC_URL=http://localhost:8648 \
AGENT_ADDRESS="NQ11 AAAA AAAA AAAA AAAA AAAA AAAA AAAA AAAA" \
AGENT_KEY=test-agent-key-123 AGENT_BANK_NAME=Moniepoint \
AGENT_BANK_ACCOUNT=9876543210 AGENT_BANK_ACCOUNT_NAME="Yaba Agent" \
TELEGRAM_WEBHOOK_SECRET=s3cret \
npm run build && npx next start -p 3100    # terminal 2
APP=http://localhost:3100 npm run test:e2e # terminal 3: 60 checks (84 with the optional settings listed at the top of scripts/e2e.mjs)
```

## Before opening a pull request

- `npm run lint && npm run typecheck && npm run build` pass.
- `npm run test:e2e` passes.
- UI changes were tried at 360px width and inside Nimiq Pay if possible.
- Keep copy short and plain. Error messages must tell people what to do next.

## Code style

- TypeScript strict, server-only modules import `server-only`.
- Money logic lives in `src/lib/orders.ts`; keep it there and keep it tested.
- No new dependency without a reason in the PR description.

By contributing you agree your work is released under the [MIT License](LICENSE) and that you follow the [Code of Conduct](CODE_OF_CONDUCT.md).
