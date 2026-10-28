---
name: backend
description: Work on the UtsavVibe backend (Express + Prisma + MySQL + Stripe). Use when adding or changing API endpoints, the database schema, markets/pricing/tax/shipping logic, checkout, Stripe webhooks, or admin auth.
---

Read `backend/CLAUDE.md` first, then follow the matching recipe.

## Add an admin endpoint
1. Create or extend a router in `backend/src/routes/`; mount it in `src/index.ts` under `/api/admin/<name>` (already behind `requireAdmin`).
2. Validate input with zod; return `{ error }` on failure, never raw errors.
3. Keep amounts as integer minor units; report per currency.
4. `npm -w backend run typecheck`, then exercise it with curl using a session cookie (log in via `POST /api/auth/login`, save with `-c jar`, send with `-b jar`).

## Change the schema
1. Edit `backend/prisma/schema.prisma`. Long strings use `@db.Text` and must NOT have `@default` (MySQL).
2. `npx prisma db push` from `backend/`. Never `--force-reset` without the user's explicit consent.
3. Run `npm -w backend run typecheck`; fix every `create` that now lacks the new required field.
4. Update seed/create-admin scripts if affected.

## Add a market field or new market behaviour
Markets own currency, countries, tax rate (bps) and inclusive flag, and shipping rates. Pricing logic lives in `src/money.ts`; the quote and checkout both go through `priceCart` in `routes/store.ts`, so change it once there.

## Checkout / Stripe changes
- Keep server-side pricing; the client sends only `variantId` + `quantity`.
- Webhook must stay idempotent and use the raw body (registered before `express.json()`).
- Without keys the checkout must fail cleanly and cancel the pending order.
- Test with `stripe listen --forward-to localhost:4000/api/webhooks/stripe` and test card 4242 4242 4242 4242 once the user adds keys.

## Auth changes
Sessions store only a sha256 of the cookie token. Keep login rate limiting and the unknown-user dummy hash. Writes need a same-origin `Origin` header.

## Test data hygiene
Delete only rows you created (probe products/orders/customers/users). Reset the `Counter` row if you created orders so numbering restarts at 1001.
