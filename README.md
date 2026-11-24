# UtsavVibe

Custom ecommerce platform (replaces Shopify). Markets: UK/GBP, US/USD, CA/CAD. Payments: Stripe.

- `backend/`  Express + TypeScript + Prisma + **MySQL 8** + Stripe (REST API)
- `frontend/` Next.js (App Router): SSR storefront at `/[market]`, admin at `/admin`

## What you get
- **Storefront** per market: catalog, collections, cart with gift card codes, Stripe Checkout, blog, CMS pages, store policies, menus.
- **Admin**: orders and draft orders (payment links, tracking, labels, emails), products (variants, per-market prices, images, SKU/barcode/QR generation, bulk label printing, Shopify CSV import), collections, gift cards (issue, sell online, redeem), carrier postage on orders (Shippo), customers, markets (tax, shipping), analytics, Online Store (pages, blog, menus, preferences), and Settings (General, Payments, Users, Roles and permissions, Locations, Notifications, Policies, Appearance, My account).
- **Staff access**: users with roles (Owner, Administrator, Fulfilment, Catalog manager, Content editor, Support, or your own). Permissions are enforced by the API.
- **Growth and safety**: Google Merchant and Meta catalog feeds, abandoned-checkout emails (opt-in), free-shipping bar and low-stock notes, fraud flags on orders (Stripe Radar plus store checks), optional Stripe Tax, API keys and signed webhooks for outside tools, two-factor sign-in, security log, SEO (sitemap, structured data, hreflang).
- Also built: in-store QR sales with offline cash mode and card readers, refunds, discount codes, per-location stock with transfers, customer accounts and reviews, campaigns, Quebec-style tax parts (GST/HST/PST/QST). Not built yet: themes, multi-store, Quebec French. Carrier postage needs a free Shippo account and `SHIPPO_API_KEY` in `backend/.env`; Stripe keys are also still to be added.
- Seasonal store tip: Stripe has no monthly fee, so an off-season site costs only hosting. Back up the database before you scale the server down.

## Run (macOS, Windows, Linux)

**You need:** [Node.js 20+](https://nodejs.org), [Git](https://git-scm.com) and [Docker Desktop](https://www.docker.com/products/docker-desktop) (running).

```
git clone https://github.com/keyurmistry21/utsavvibe.git
cd utsavvibe
npm run up
```

`npm run up` does everything: installs packages, creates `backend/.env` from the template, starts MySQL (:3307) and a mail catcher in Docker, creates the tables, seeds the three markets, then runs the API on http://localhost:4000 and the website on http://localhost:5173. Ctrl-C stops the servers. (`make up` does the same on macOS/Linux, but you never need `make`, which is not available on Windows.)

Then, in a **second terminal**, create your admin login and open http://localhost:5173/admin:

```
npm run create-admin -- you@example.com "a long password" "Your Name"
```

Optional: `npm run demo` adds 6 sample products priced in all three markets (`npm run demo:clear` removes them). `npm run down` stops MySQL (data is kept).

Dev emails land in the local inbox at http://localhost:8026 (Mailpit). For real sending set `SMTP_*` and `MAIL_FROM` in `backend/.env`.

### Troubleshooting
- **"Docker is not installed or not running"**: install Docker Desktop, start it, and wait until it says it is running. Then run `npm run up` again.
- **Port already in use**: something else uses 3307 (MySQL), 4000 (API) or 5173 (website). Stop it, or change the port in `docker-compose.yml` / `backend/.env`.
- **Windows**: use PowerShell or Windows Terminal, run commands from the project folder, and don't run `npm audit fix --force` (it can break dependency versions).
- **Reset your local data**: `docker compose down -v` deletes the local database volume. Only do this if you are sure.

### Stripe
Add `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` to `backend/.env` when ready (without them checkout shows "STRIPE_SECRET_KEY not set"). Local webhook: `stripe listen --forward-to localhost:4000/api/webhooks/stripe`. Other optional keys (Instagram, Meta, SMS, card reader) are listed at the bottom of `backend/.env.example`.

## Rules
- Money = integer minor units (pence/cents).
- Prices are manual per variant per market; tax + shipping are per market.
- Server recomputes prices/tax/shipping at checkout; never trusts the client.
- Admin auth: email + scrypt password, httpOnly session cookie (7 days), login rate-limited. Roles decide what each staff member can do.
- No card or bank numbers are stored here: Stripe Checkout takes cards, and the payout bank is added in the Stripe Dashboard (Settings → Payments shows the status).
- MySQL TEXT columns can't have defaults, so create calls must pass `tags`/`notes`/etc. explicitly.

## Before production
- Use `prisma migrate` (not `db push`) and a managed MySQL with backups; change the compose passwords.
- Set `NODE_ENV=production` (Secure cookie) and serve over HTTPS.
