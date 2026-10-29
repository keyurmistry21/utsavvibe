# Backend

Express 5 (async handlers may throw; the error handler in `src/index.ts` maps `ZodError` to 400 and `err.status`), TypeScript ESM, Prisma 6, MySQL.

## Layout
- `src/index.ts` app wiring. Order matters: Stripe webhook (raw body) → `express.json()` → `/api/store` (public) → `/api/auth` → `/api/admin` (behind `requireAdmin`, then a per-router `guard()` permission check, see Staff, roles, permissions). Startup runs `ensureRoles()` and `ensureDefaultLocation()` before listening, and the API has no auto-reload when started with plain `tsx`: restart it after backend edits (`npm -w backend run dev:server` watches).
- `src/auth.ts` scrypt password hashing, sessions (only the sha256 of the cookie token is stored), `requireAdmin` (session check + Origin check on writes).
- `src/money.ts` `computeTax`, `computeTotal`, `pickShipping`. All integer minor units. Tax can be inclusive (already in price) or exclusive (added at checkout).
- `src/db.ts` Prisma client, `parseJson`, `nextOrderNumber` (Counter table).
- `src/routes/` admin: `markets`, `products`, `orders`, `drafts`, `customers`, `analytics`, `settings`, `onlineStore` (pages + preferences), `collections`, `blog`, `giftCards`, `shippingLabels`, `locations`, `policies`, `payments`, `users` (staff + roles); `store` (public catalog/quote/checkout/site/pages/policies + Stripe webhook); `auth`. Shared: `permissions.ts`, `stock.ts`, `html.ts`, `mail.ts`/`emails.ts`/`orderEmails.ts`, `checkout.ts`, `images.ts`/`storage.ts`.
- `prisma/schema.prisma`, `prisma/seed.ts` (UK/US/CA markets), `prisma/create-admin.ts`.

## Conventions
- Validate every request body with zod. Return `{ error: string }` on failure.
- JSON-in-string columns (`tags`, `options`, `countries`, `shippingAddress`) are stored as `@db.Text` JSON strings; read with `parseJson`, write with `JSON.stringify`, and shape responses so clients get real arrays/objects.
- MySQL TEXT columns cannot have defaults. Every `create` must pass `tags: "[]"`, `notes: ""`, `description`, etc. explicitly. Typecheck finds missing ones.
- Reports/analytics group by market/currency. Never add amounts in different currencies.
- Checkout: price from DB per market, check product is active and in that market, check stock, create a pending Order, then a Stripe Checkout Session (currency = market currency, tax as a separate line when exclusive, shipping as `shipping_options`). If Stripe fails, mark the order `failed`/`cancelled`.
- Webhook is idempotent: only the first `checkout.session.completed` flips `pending → paid` and decrements stock.

## Regions, drafts, shipping
- `MarketRegion` = province/state with its own total tax rate (CA seeded with all 13). `taxRateFor(market, region)` in `money.ts` picks region rate over market default. Checkout requires a region when the market has regions. `ProductMarket.regions` (JSON, null = whole market) limits where a product sells.
- Draft orders are `Order.status = "draft"` (`routes/drafts.ts`): hidden from the Orders list unless `?status=draft`; admin may override unit price, shipping and discount. Payment link = Stripe Checkout Session (`checkout.ts`, discount via one-off coupon, 24h expiry); manual `mark-paid` (cash/bank transfer) checks stock, decrements it, and makes it an open order. The webhook moves paid drafts to `open`.
- Custom draft items have no `variantId`; `OrderItem.taxable/physical/weightG` drive tax (`priceTotals` taxes only the taxable share, discount spread proportionally), shipping (an order with nothing physical ships free) and the package weight prefill on the order page.
- Customers (`routes/customers.ts`): email is optional (phone-only allowed, at least one required); `address` JSON is the default delivery address; `taxExempt` makes draft tax 0 (and net price in tax-inclusive markets); `/customers/search?q&limit&offset` pages the picker. Drafts reference `customerId`, not inline customer fields.
- Customer list/export/import: `customerRows` builds one row per customer (location from default address, else the last order's; orders/spend via `groupBy`; spend is per currency, so there is no "sort by amount spent"). CSV export prefixes cells starting with `= + - @` with `'` (formula injection) and import strips it; import upserts by email, skips bad rows with reasons, max 1000 rows per request.
- Fulfilment: `PATCH /orders/:id` stores carrier/tracking/weight; fulfilling needs `paymentStatus = paid`. Ship-from address is in the `Setting` table (`/api/admin/settings/ship-from`). Buying carrier postage (Shippo/EasyPost) is not built.

## Products
Product flags drive behaviour everywhere: `trackInventory`/`continueSelling` (`stock.ts`: `canSell`, `shouldDecrement`, used by storefront stock, checkout, draft mark-paid and the Stripe webhook), `chargeTax` and `physical` (set `OrderItem.taxable/physical`, so tax and shipping follow). `description` is sanitized HTML (`html.ts`, `sanitize-html` allow-list: formatting, tables, images, YouTube/Vimeo iframes only; empty iframes dropped) on every save; the storefront renders it with `dangerouslySetInnerHTML`, so never store unsanitized HTML. URL handle is editable and unique (`freeHandle` generates `name`, `name-2`, …). `GET /products/list|stats|export` and `POST /products/bulk` serve the admin list; `GET /products` (full array) is still used by the draft order picker.

## Email
`mail.ts` (nodemailer SMTP transport, `sendMail` never throws and logs every attempt to `EmailLog`), `emails.ts` (HTML + text templates; **every dynamic value goes through `esc()`**, names/addresses/titles are untrusted), `orderEmails.ts` (`sendOrderConfirmation` once per order unless `force`, `sendPaymentLinkEmail`, `previewEmail`). Triggers: Stripe webhook after the paid-flip commits (fire-and-forget), draft `mark-paid` (`notify`), `POST /drafts/:id/email-payment-link`, `POST /orders/:id/resend-confirmation`. Dev SMTP is the Mailpit container (SMTP :1026, inbox UI :8026); production needs a real provider in `SMTP_*` + `MAIL_FROM` (use a domain with SPF/DKIM set up or mail lands in spam). Without `SMTP_HOST` nothing is sent and attempts are logged as `skipped`.

## Images
`routes/products.ts` image endpoints take the raw file as the request body (no multipart). `images.ts` decodes with sharp (only JPEG/PNG/WebP/GIF, 50MP cap, EXIF rotated then stripped) and writes `<id>.webp` + `<id>-thumb.webp` through `storage.ts` into `UPLOAD_DIR` (default `backend/uploads`, git-ignored), served at `/uploads` with immutable caching. Swap `storage.ts` for S3/R2 when deploying to a host without a persistent disk.

## Online store
`routes/onlineStore.ts` (admin, `/api/admin/online-store`): `Page` CRUD + bulk, and `/preferences` (store name, announcement, SEO, menus; zod-validated, stored in `Setting` key `onlineStore`, `loadPrefs()` fills defaults). Public: `GET /api/store/site`, `/pages`, `/pages/:handle` (visible only). Page content goes through `sanitizeDescription` on every save.

## Collections, blog
`routes/collections.ts`: `kind` manual (`CollectionProduct` rows with `position`) or smart (`rules` JSON `{match, conditions:[{field: tag|vendor|type|title, op: is|contains, value}]}` evaluated in memory by `collectionProductIds`; an empty rule list matches nothing). `POST /collections/preview` powers the live rule preview. Storefront `GET /store/markets/:code/collections/:handle` returns only active products sold in that market, in collection order; hidden collections 404. `routes/blog.ts`: one blog of `BlogPost`s; public only when `published` and `publishedAt <= now` (future date = scheduled); `POST /blog/images` stores a re-encoded WebP (`blog-<uuid>`) and the cover must be `/uploads/...` or https. Content goes through `sanitizeDescription` on every save. Permissions: collections need `products.view|manage`, blog needs `online_store.manage`.

## Gift cards
`giftCards.ts` + `routes/giftCards.ts` (`gift_cards.view|manage`). Code = 16 random chars from a no-0/O/1/I alphabet (`XXXX-XXXX-XXXX-XXXX`, matched case/space/dash-insensitively); a card only works in markets with its currency. `balance` changes only through `GiftCardTx` ledger rows (`issue`, `redeem`, `release`, `adjust`). Checkout (`store.ts`): `giftCardFor` + `splitPayment` decide how much the card covers (never more than the items+tax, because Stripe discounts can't touch shipping, and never leaving a Stripe charge under 0.50). The amount is **reserved** atomically inside the order transaction (`reserve`), passed to Stripe as a one-off coupon, and **released** (`releaseForOrder`, idempotent) when Stripe session creation fails, the session expires, or staff cancel the order. When the card covers everything the order is created paid (`paymentMethod: gift_card`), stock is decremented, and no Stripe session exists. Gift cards cannot pay for gift cards. `Product.isGiftCard` forces physical/tax/stock-tracking off; paid orders (`issueForPaidOrder`, called from the Stripe webhook) issue one card per unit bought and email the buyer, idempotent per `OrderItem` (`GiftCard.orderItemId`). Draft orders reject gift card products.

## Carrier postage (Shippo)
`shippo.ts` is a thin REST client (`SHIPPO_API_KEY`; `SHIPPO_API_URL` overrides the host so tests can use a local fake). `routes/shippingLabels.ts` (under `/api/admin/orders`, `orders.manage`): `GET /:id/shipping` (configured? existing label), `POST /:id/shipping/rates` (parcel cm/g -> sorted rates; a different destination country than the ship-from builds a customs declaration from the order items), `POST /:id/shipping/buy` (claims `labelId = "buying"` first so a double click can't buy twice, stores carrier, tracking, label URL and cost on the order; **never buys automatically**), `POST /:id/shipping/void`. Only paid, non-draft, non-cancelled orders with physical items. The Shippo calls are verified against a local fake, not the live API: run one real test label with a Shippo test token before relying on it.

## Shopify import
`shopifyImport.ts` parses Shopify's product CSV (RFC 4180 parser, rows grouped by Handle, options -> variants, image-only rows, `Price / <Country>` market columns). `POST /products/import/preview` takes the CSV as `text/csv` and returns a token (parsed data is kept in memory for an hour, per user) plus market/price-column suggestions; `POST /products/import` imports up to 15 handles per call with a chosen price source per market. Existing handles are skipped, duplicate SKUs are blanked with a warning, descriptions are sanitized. Images are downloaded only from Shopify's CDN hosts (allow-list + DNS check against private addresses, no redirects, 12 MB cap) and re-encoded by sharp.

## Error handling
The handler in `index.ts` maps `ZodError` to 400 `{error:"validation"}`, `err.status`, and Prisma `P2002` (unique violation) to a friendly 409 (SKU, customer email, handle). Forms show these under the field, so keep the wording stable ("SKU", "email", "URL handle"). Products: `POST /products/codes/taken` tells the editor which SKUs/barcodes other products already use (Generate buttons); SKU is unique in the DB (case-insensitive), barcode is not.

## Staff, roles, permissions
`permissions.ts`: permission keys (`orders.view|manage`, `products.*`, `customers.*`, `analytics.view`, `markets.manage`, `online_store.manage`, `settings.manage`, `users.manage`; `manage` implies `view`), default roles (Owner locked with everything, Administrator, Fulfilment, Catalog manager, Content editor, Support), `ensureRoles()` runs on startup (never overwrites edited roles; users without a role become Owners, which is how pre-RBAC admins migrate). `auth.ts`: `currentUser` loads the role on every request, so role/active changes apply immediately and deactivated users are signed out; `guard({read, write, readOpen})` is mounted per router in `index.ts` (GET needs a read permission, other methods a write one; orders.manage may read products/customers for the draft picker). `routes/users.ts`: staff + roles CRUD with rules that must stay: you can't grant access you don't hold, only owners touch owners or assign Owner, no self role change/deactivate/delete, always one active owner, a role with users can't be deleted, Owner role is immutable, reset-password/deactivate delete the user's sessions. `create-admin` makes an Owner.

## Scan lookup
`GET /api/store/lookup/:code` (public, `routes/store.ts`): SKU or barcode of an ACTIVE product -> `{market, handle, variantId}` (market from `?market=` if the product is sold there, else the first active one). Used by the `/p/<code>` QR landing page. `publicUrl` in the online-store preferences is the public address QR codes should use.

## Locations and policies
`routes/locations.ts` (`/api/admin/locations`, `settings.manage`): the first location is the default and the default can't be deleted or deactivated; `shipFromAddress()` returns the default location (else the legacy `shipFrom` Setting) and backs `GET/PUT /settings/ship-from`, which labels and packing slips read. Stock is NOT per location. `routes/policies.ts`: seven fixed keys (`refund, privacy, terms, shipping, contact, legal, cancellation`), empty content = unpublished, content sanitized on save; public `GET /api/store/policies[/:key]` returns published ones only.

## Payments page
`routes/payments.ts` (`/api/admin/payments`, needs `settings.manage`): read-only Stripe status for Settings → Payments (account, charges/payouts enabled, bank last4 via `accounts.listExternalAccounts`, balance, recent payouts; stripe v23 uses `accounts.retrieveCurrent()`). Never collect or store card/bank numbers here: customers pay on Stripe Checkout, the payout bank is added in the Stripe Dashboard.

## Verifying backend work
`npm -w backend run typecheck`, then drive the real API (curl with a session cookie, or Playwright `page.evaluate(fetch)` after logging in). Always test the 403 side of a new permission and the unhappy paths (duplicate, blocked, missing). Clean up only rows you created (scripts via `npx tsx` with `DATABASE_URL="mysql://utsavvibe:utsavvibe@localhost:3307/utsavvibe"`); never `--force-reset`. A new table = edit `schema.prisma` + `npx prisma db push` (additive is safe), then restart the API.

## Commands
- `npm -w backend run dev:server` (tsx watch), `typecheck`, `db:push`, `seed`, `create-admin`
- Schema change: edit `schema.prisma` → `npx prisma db push` (dev). Use `prisma migrate` before production.

## Env (`backend/.env`, template in `.env.example`)
`DATABASE_URL` (MySQL on :3307), `PORT`, `STOREFRONT_URL` (also the allowed Origin for admin writes), `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.
