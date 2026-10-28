# UtsavVibe

Custom ecommerce platform replacing Shopify. Sells in three markets (UK/GBP, US/USD, CA/CAD), takes payments with Stripe, has its own admin.

- `backend/`  Express 5 + TypeScript + Prisma + MySQL 8 + Stripe. See `backend/CLAUDE.md`.
- `frontend/` Next.js 16 App Router: SSR storefront `/[market]`, client-rendered admin `/admin`. See `frontend/CLAUDE.md`.
- Project skills: `.claude/skills/backend`, `.claude/skills/frontend`.

## Commands (repo root)
- `make up` start MySQL (Docker, host port 3307), push schema, seed markets, run API :4000 + web :5173
- `make down` stop MySQL (data kept in the Docker volume)
- `make demo` / `make demo-clear` add or remove 6 sample products (handles start with `demo-`) priced in all 3 markets
- `make admin EMAIL=… PASSWORD='…' NAME='…'` create/reset an admin user
- `npm run typecheck` backend + frontend
- Port 3306 belongs to another local project's MySQL. Never touch that container.

## Rules that apply everywhere
- Money is integer minor units (pence/cents), never floats. Convert only at the UI edge (`toMinor` / `toMajor` / `money` in `frontend/src/lib/api.ts`).
- Prices are set manually per variant per market. Tax and shipping are per market. Never sum amounts across currencies.
- The server computes prices, tax, shipping and totals at checkout. Never trust prices from the client.
- Admin auth is an httpOnly session cookie (`uv_session`). The browser only talks to the API through the Next proxy (`/api/*` rewrite), so cookies are same-origin.
- Stripe keys live in `backend/.env` only (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`). The app runs without them; checkout returns "STRIPE_SECRET_KEY not set" and cancels the order.
- Do not run `prisma db push --force-reset` or delete DB data you didn't create. Prisma blocks it without explicit user consent.
- Verify changes with `npm run typecheck`; for UI changes also run `make up` and look at the page.
