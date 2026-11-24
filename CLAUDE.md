# UtsavVibe

Custom ecommerce platform replacing Shopify. Sells in three markets (UK/GBP, US/USD, CA/CAD), takes payments with Stripe, has its own admin.

- `backend/`  Express 5 + TypeScript + Prisma + MySQL 8 + Stripe. See `backend/CLAUDE.md`.
- `frontend/` Next.js 16 App Router: SSR storefront `/[market]`, client-rendered admin `/admin`. See `frontend/CLAUDE.md`.
- Project skills: `.claude/skills/backend`, `.claude/skills/frontend` (recipes for adding endpoints, permissions, admin and settings pages, forms, validation, testing).

## What exists (feature map)
- Storefront (`/[market]`): catalog, collections (`/collections/<handle>`), product pages, cart (with gift card codes), Stripe Checkout, order confirmation, blog (`/blog`), CMS pages (`/pages/<handle>`), policies (`/policies/<key>`), header/footer menus, announcement bar, SEO.
- Admin (`/admin`): Home, Orders (+ drafts, payment links, mark paid, tracking, labels, emails), Products (variants, per-market prices, images, SKU/barcode/QR generation, bulk label printing, Shopify CSV import, gift card products), Collections (manual and automated), Gift cards (issue, sell, redeem), Carrier postage on orders (Shippo), Customers (import/export), Markets (tax, regions, shipping), Analytics (earnings by 1/3/6/12 months, this year or a custom range, yearly revenue, profit), Expenses (staff log purchases in the currency of the market they work in; admins decide which markets each staff member may transact in), Online Store (Pages, Blog posts, Preferences incl. menus), Marketing (Google and Meta product feeds, abandoned-checkout reminders), Settings (General, Payments, Checkout and tax, Users, Roles and permissions, Locations, Notifications, Policies, Appearance, Apps and API, Security, My account).
- Built-in protection: Stripe Radar plus store fraud flags on orders, optional Stripe Tax automatic tax, JWT sign-in with optional 2FA, API keys and signed webhooks (the replacement for Shopify apps), security log, rate limits, security headers. SEO: sitemap, robots, canonical + hreflang, JSON-LD.
- Access control: staff users with roles; Owner is locked; permissions enforced by the API (`guard()`), mirrored in the UI.
- Also built: in-store QR sales (`/admin/sell`: basket, discount, card payment QR or cash), refunds and returns on orders, discount codes (percent, fixed, free shipping), storefront search, order tracking page, 301 redirects (Shopify URLs + `Online Store → Redirects`), cookie consent + Google Analytics 4 + Meta Pixel (off until the env ids are set), first-party visitor tracking with Sales insights and traffic, tax-by-province report with GST/HST/PST/QST parts, low-stock emails to owners, buy-X-get-Y codes, per-location stock with transfers and staff location limits (Inventory), customer accounts (email code sign-in), product reviews with moderation, offline cash sales on the till, email + SMS campaigns, Instagram feed, Meta Conversions API, Stripe Terminal card readers (the last four need keys in `backend/.env` and were not tested against the live services).
- Also built (Shopify comparison fixes): per-variant images (storefront switches the gallery), `Products → Prices by market` (edit/replace/percent-change prices for one market in bulk), order statistics strip, inventory with product links and inline stock set, customer purchase history, Files library (`Online Store → Files`: upload image/PDF, copy link), one-click US states / CA provinces on Markets, fix: stock typed on a new product was lost on first save.
- Storefront theme (ported from the Shopify theme): `frontend/src/app/theme.css`, copy and images in `frontend/src/lib/brand.ts` + `frontend/public/theme/`; hero slider, drop-down (mega) menu with sub-links (`Online Store → Preferences`), pop-up message, wishlist (this device only), quick view, `?tag=` / `?size=` filters on collections. `npm run seed:content` adds the starter pages (About, Contact, FAQ, Rakhi, Eco-friendly Ganesha), 3 collections, menus and pop-up (also run by `npm run up`; only fills what is missing).
- Not built: Quebec French, Themes, multi-store (a second store = a second deployment), purchase orders, multiple blogs, collection images, importing Shopify customers/orders/collections, gift cards in draft orders, EasyPost (only Shippo).

## Commands (repo root)
- Windows (no `make`, no bash): use the npm equivalents `npm run up`, `npm run down`, `npm run create-admin -- you@x.com "a long password" "Your Name"`, `npm run demo`, `npm run demo:clear`. Needs Node 20+ and Docker Desktop running. `make up` runs the same `scripts/dev.mjs`.
- `make up` start MySQL (Docker, host port 3307), push schema, seed markets, run API :4000 + web :5173
- `make down` stop MySQL (data kept in the Docker volume)
- `make demo` / `make demo-clear` add or remove 6 sample products (tagged `demo`, plain handles) priced in all 3 markets
- `make admin EMAIL=… PASSWORD='…' NAME='…'` create/reset an admin user
- `npm run typecheck` backend + frontend
- Port 3306 belongs to another local project's MySQL. Never touch that container.

## Rules that apply everywhere
- Money is integer minor units (pence/cents), never floats. Convert only at the UI edge (`toMinor` / `toMajor` / `money` in `frontend/src/lib/api.ts`).
- Prices are set manually per variant per market. Tax and shipping are per market. Never sum amounts across currencies.
- The server computes prices, tax, shipping and totals at checkout. Never trust prices from the client.
- Admin auth is an httpOnly session cookie (`uv_session`). The browser only talks to the API through the Next proxy (`/api/*` rewrite), so cookies are same-origin.
- `backend/.env` holds `APP_SECRET` (signs login JWTs, encrypts 2FA secrets; required in production). Stripe keys live in `backend/.env` only (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`), and so does `SHIPPO_API_KEY` (carrier postage; postage is charged to the Shippo account, never to a card typed here). The app runs without them; checkout returns "STRIPE_SECRET_KEY not set" and cancels the order.
- Do not run `prisma db push --force-reset` or delete DB data you didn't create. Prisma blocks it without explicit user consent.
- Verify changes with `npm run typecheck`; for UI changes also run `make up` and look at the page.
- Security: never put card or bank numbers in this app (customers pay on Stripe Checkout, payout banks are added in the Stripe Dashboard). Never commit `.env`, uploads, DB files, or any real credential; scan the diff for keys before committing. Admin access changes go through roles, never hard-coded emails.
- Commits are made only when the user asks and are not pushed unless asked.
