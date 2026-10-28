---
name: backend
description: Work on the UtsavVibe backend (Express + Prisma + MySQL + Stripe). Use when adding or changing API endpoints, the database schema, markets/pricing/tax/shipping logic, checkout, Stripe webhooks, or admin auth.
---

Read `backend/CLAUDE.md` first, then follow the matching recipe.

## Add an admin endpoint
1. Create or extend a router in `backend/src/routes/`; mount it in `src/index.ts` under `/api/admin/<name>` with a permission guard: `app.use("/api/admin/<name>", guard({ read: [...], write: [...] }), router)` (`readOpen: true` lets any signed-in staff read). `requireAdmin` already runs for everything under `/api/admin`.
2. Validate input with zod; return `{ error }` on failure, never raw errors.
3. Keep amounts as integer minor units; report per currency.
4. `npm -w backend run typecheck`, then exercise it with curl using a session cookie (log in via `POST /api/auth/login`, save with `-c jar`, send with `-b jar`).

## Change the schema
1. Edit `backend/prisma/schema.prisma`. Long strings use `@db.Text` and must NOT have `@default` (MySQL).
2. `npx prisma db push` from `backend/`. Never `--force-reset` without the user's explicit consent.
3. Run `npm -w backend run typecheck`; fix every `create` that now lacks the new required field.
4. Update seed/create-admin scripts if affected.

## Add or change a permission
1. Add the key to `PERMISSION_GROUPS` in `src/permissions.ts` (`area.view` / `area.manage`; manage implies view). Decide which default roles get it (`DEFAULT_ROLES`); existing edited roles are never overwritten, so tell the user they must tick it.
2. Guard the router in `src/index.ts`; write the unhappy-path test: a role without the key gets 403.
3. Frontend: add the path prefix to `ROUTE_PERMS` (`lib/perms.tsx`) and the link's `perm` in `components/admin/nav.ts`.
4. Rules in `routes/users.ts` must keep holding: you can't grant access you lack, only owners touch owners/assign Owner, no self role change/deactivate/delete, always one active owner, roles with users can't be deleted, Owner is immutable, password reset/deactivate kills sessions.

## Add a content table (pages, policies, locations style)
Model in `schema.prisma` (Text columns have no defaults), `npx prisma db push`, admin CRUD router + guard, public read endpoint in `routes/store.ts` that returns only published/visible rows, sanitize any HTML with `sanitizeDescription` on every save, unique handles with friendly 400/409 messages the form can show under the field. Restart the API afterwards.

## Add a market field or new market behaviour
Markets own currency, countries, tax rate (bps) and inclusive flag, and shipping rates. Pricing logic lives in `src/money.ts`; the quote and checkout both go through `priceCart` in `routes/store.ts`, so change it once there.

## Checkout / Stripe changes
- Keep server-side pricing; the client sends only `variantId` + `quantity`.
- Webhook must stay idempotent and use the raw body (registered before `express.json()`).
- Without keys the checkout must fail cleanly and cancel the pending order.
- Test with `stripe listen --forward-to localhost:4000/api/webhooks/stripe` and test card 4242 4242 4242 4242 once the user adds keys.

## Auth changes
Sessions store only a sha256 of the cookie token. Keep login rate limiting and the unknown-user dummy hash. Writes need a same-origin `Origin` header.

## Errors the UI shows under a field
Unique violations become a 409 in the error handler (`P2002`), and handle/SKU/email conflicts should keep their wording (`SKU`, `email`, `URL handle`) because forms match on it. Validate everything with zod and return friendly messages for the common mistakes.

## Money, Stripe and payouts
No card or bank numbers are collected or stored here. Payouts are configured in the Stripe Dashboard; `routes/payments.ts` only reads status (`accounts.retrieveCurrent()` in stripe v23). Never log keys.

## Test data hygiene
Delete only rows you created (probe products/orders/customers/users). Reset the `Counter` row if you created orders so numbering restarts at 1001.
Test through the real flow: log in, hit the endpoint, check both the allowed and the 403 case, then delete what you made with a one-off `npx tsx` script (`DATABASE_URL="mysql://utsavvibe:utsavvibe@localhost:3307/utsavvibe"`). Keep the user's own admin accounts and data. Restart the API after backend edits if it was started with plain `tsx`.
