# Privacy Policy

_Last updated: 10 November 2026_

NimPoint is a peer-to-peer marketplace that connects Nimiq Pay users with independent cash agents. We collect as little as possible.

## What we store

| Data | Why | Who can see it |
| --- | --- | --- |
| Your Nimiq wallet address | To link orders to you and show your history | Public on-chain anyway; shown shortened on the proof page |
| Order amount, rate, memo, status, timestamps | To run the order and show its progress | You and the agent |
| Bank name, account number, account name (bank cash-outs only) | So the agent can pay you | Full number: only the paying agent. Everyone else sees `••••1234` |
| Your rating and optional comment | Agent reputation | Aggregated on agent profiles |
| Optional signed receipt (public key + signature) | Proof you confirmed receipt | You and the agent |
| Registration (optional): your wallet address and the time you registered | To count real users. You sign a message to prove the wallet is yours; the signature is checked and not kept | Only the total is public |
| Which Nimiq network an order used (mainnet or test) | To keep test orders out of the real numbers | Public on the proof page |

Saved bank accounts and your last-used agent are stored **only on your device** (browser storage) and can be removed from the app.

## What we don't do

- No tracking, analytics cookies or advertising.
- No selling or sharing of data with third parties.
- No access to your private keys. Payments are signed by you inside Nimiq Pay.

## Third parties

- **Nimiq blockchain:** transactions are public by design.
- **CoinGecko:** we fetch the NIM price. No personal data is sent.
- **Telegram:** order details are sent to the agent's private Telegram chat so they can pay you.
- **Vercel and Upstash:** hosting and the order database.

## Retention and deletion

Orders are kept for up to 12 months for dispute resolution, then deleted. To have your order data removed sooner, open an issue with your order ID only (no personal details), or contact the maintainers privately.
