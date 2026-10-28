# UtsavVibe

Custom ecommerce platform (replaces Shopify). Markets: UK/GBP, US/USD, CA/CAD. Payments: Stripe.

- `backend/`  Express + TypeScript + Prisma + **MySQL 8** + Stripe (REST API)
- `frontend/` Next.js (App Router): SSR storefront at `/[market]`, admin at `/admin`

## Run
```
make up      # MySQL (Docker, :3307) + schema + seed + API :4000 + Next :5173. Ctrl-C stops the servers.
make down    # stop MySQL (data kept)
make admin EMAIL=you@example.com PASSWORD='a long password' NAME='You'
```
Log in at http://localhost:5173/admin. Customer emails sent in dev land in the local inbox at http://localhost:8026 (Mailpit); set `SMTP_*` and `MAIL_FROM` in `backend/.env` for real sending.

Add `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` to `backend/.env` when ready.
Local webhook: `stripe listen --forward-to localhost:4000/api/webhooks/stripe`.

## Rules
- Money = integer minor units (pence/cents).
- Prices are manual per variant per market; tax + shipping are per market.
- Server recomputes prices/tax/shipping at checkout; never trusts the client.
- Admin auth: email + scrypt password, httpOnly session cookie (7 days), login rate-limited.
- MySQL TEXT columns can't have defaults, so create calls must pass `tags`/`notes`/etc. explicitly.

## Before production
- Use `prisma migrate` (not `db push`) and a managed MySQL with backups; change the compose passwords.
- Set `NODE_ENV=production` (Secure cookie) and serve over HTTPS.
