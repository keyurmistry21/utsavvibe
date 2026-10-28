# Frontend

Next.js 16 App Router + React 19 + TypeScript. Plain CSS in `src/app/styles.css` (no UI library).

## Layout
- `src/app/[market]/…` SSR storefront (server components): home grid, product page, cart, order confirmation. Market code in the URL (`/uk`, `/us`, `/ca`); unknown market → 404.
- `src/app/admin/…` admin. `layout.tsx` is a client component: login gate (`/api/auth/me`), dark sidebar, search (⌘K), orders badge. Pages are thin wrappers around `src/components/admin/*`.
- `src/components/admin/` client components: `Home`, `Dashboard` (Analytics), `Products` (list + form), `Orders`, `Customers`, `Markets`, `Settings`, `hooks.tsx` (`useApi`, `Badge`, `TagList`), `nav.ts` (sidebar links + search actions).
- `src/components/store/` cart context (per-market localStorage), `AddToCart`, `CartPage` (quote + Stripe checkout), `ClearCart`.
- `src/lib/api.ts` `api()` for `/api/admin/*`, `auth()` for `/api/auth/*`, money helpers. `src/lib/store.ts` server-side fetch to the backend for storefront SSR (revalidate 60s).
- `next.config.mjs` rewrites `/api/*` to `BACKEND_URL` (default `http://localhost:4000`).

## Conventions
- Storefront data is fetched in server components via `src/lib/store.ts`. Interactive bits (cart, add-to-cart) are small client components. Add `generateMetadata` to new storefront pages.
- Admin components start with `"use client"`. A 401 from any admin call fires `admin:unauthorized` and the layout returns to the login screen.
- Storefront look: warm cream theme, classes prefixed `sf-`/`pcard`/`pdp`/`hero`. Generic class names (`card`, `hero`) collide with other rules, so use specific names (the product placeholder art uses `art-ph sm|lg`). `ProductArt` is the gradient fallback when a product has no image.
- Admin styles are scoped under `.admin`, storefront under `.store`. Don't add unscoped global rules.
- Prices shown to users come from the server (`/api/store/quote`); the client sends only variant ids and quantities.
- Deep links: `/admin/products?new=1`, `/admin/markets?new=1`, `/admin/orders?status=open`.
- Don't use `useSearchParams` in pages without a Suspense boundary (static prerender fails); read `location.search` in an effect instead.

## Orders, drafts, labels
- `/admin/orders` list with tabs (incl. Drafts) → `/admin/orders/[id]` (`OrderDetail`: totals, payment link / mark paid for drafts, tracking + fulfil for orders) → `/admin/orders/[id]/label` (`Label`: 4x6 label, `?type=slip` packing slip; print CSS hides the sidebar). `/admin/orders/new` and `/[id]/edit` use `DraftEditor` (live totals from `/api/admin/drafts/quote`). Carrier list + tracking URL templates in `lib/carriers.ts`.
- Provinces: product form shows a province picker per market with regions; cart page has a province select and takes the tax label from the quote response.

## Product images
- Admin: `ImageManager` inside the product form. New files wait as "pending" until the product is saved (then `uploadImage` posts the raw file body to `/api/admin/products/:id/images`); existing images reorder/alt/delete immediately. Storefront: `<img>` thumbs on cards, `Gallery` on the product page, `ProductArt` gradient when a product has no image. `/uploads/*` is proxied to the API.
- Controls are styled once at the end of `styles.css` (custom select chevron, one button height, mobile drawer). Don't restyle `select`/`button` per component.

- Storefront data goes through `lib/store.ts`, which fills missing fields (`images`, `regions`, ...) because Next can serve a cached API response from an older shape; pages may rely on those fields. Icons next to labels (`components/Icons.tsx`: Plus, ArrowLeft, ArrowRight, External) are SVGs so buttons/links can space them with `gap`; don't type `+`/`→` glyphs into labels.

## Product pages
- List: `ProductList.tsx` (same pattern as Customers: views Active/Draft/Archived, stock chips, column picker via shared `ColumnsMenu`, bulk activate/draft/archive/delete, CSV export) against `GET /products/list`. Editor: `ProductEditor.tsx` (two columns like Shopify). Adding options (Size, Color) rebuilds variants with `syncVariants`: existing combinations keep their data, refinements inherit (first child takes the old variant, others copy prices only because SKUs are unique), so never replace it with a plain regenerate. Description is edited in `RichTextEditor` (execCommand) and sanitized by the API on save. Toggles use `Switch`.
- "New customer" is a page rendered in the main panel in place of the page that opened it (`NewCustomerSheet`); callers `return` it early after all hooks so their state (e.g. the draft order being built) survives.

## Field styles
`Settings > Appearance` lets staff pick one of five input looks (default: "filled", no border; storage key `fieldStyle.v2`) (`lib/fieldStyle.ts`, generated `app/fields.css`, attribute `data-fields` on `<html>`, set early by an inline script in `app/layout.tsx`). They are `!important` override layers on top of the base field styles, so a new kind of input must be added to the selector list in `fields.css` to follow the choice. The filled style gives fields placed straight on the gray page (`.sidesec`, `.pagehead`) a darker fill so they stay visible; put new page-level fields inside one of those or inside a white `.card`.

## Form validation
Every input shows its own error under it. Pure validators live in `lib/validators.ts` (required, email, phone, money, int, decimal, postcode by country). A form builds an `errors` record from its state each render and passes it to `useValidation` (`components/admin/validation.tsx`): spread `val.props(key)` on the control (aria-invalid, blur = touched), render `<FieldError k msg={val.err(key)} />` below it, and call `val.submit()` in Save (shows all errors, focuses the first invalid field, returns false when invalid, so no request is sent). Server conflicts (duplicate SKU/email/handle, API 409) are mapped back onto the field. Errors from blur wait until the pointer is released so a layout shift cannot swallow a button click. Invalid styling is at the end of `fields.css` and covers all five field styles. Used in ProductEditor, NewCustomerSheet, AddressModal, DraftEditor, Settings, Markets, admin login and storefront checkout (`CartPage`). Don't disable Save buttons for invalid input; let the user click and see why.

## SKU, barcode, QR
`lib/codes.ts`: `makeSku` (UV-NAME-OPTION, de-duplicated), `makeEan13` (prefix 2 = GS1 internal range, valid check digit), `barcodeError` (numeric 8/12/13/14-digit barcodes must have a correct GS1 check digit; other text is allowed), `ean13Svg` (draws EAN-13/UPC-A). ProductEditor has Generate (SKU, barcode), "Generate missing" (all variants) and Preview (`CodePreview`: barcode SVG + QR via the `qrcode` package, download, print label). Generation checks the other variants and `POST /products/codes/taken` (other products' SKUs/barcodes) so it never makes a duplicate; SKU is unique in the DB (case-insensitive), barcode is not but the form warns on duplicates.

## Print labels
`/admin/products/labels` (`PrintLabels.tsx`, entry: Products list "Print labels", preselects selected products via `?ids=`): pick variants (size/colour shown from `variant.options`), copies per variant (or stock qty), label stock (50x25 / 70x40 roll, A4 21-up / 65-up sheets with "already used" slots), fields (name, variant, SKU, EAN-13 barcode, QR of SKU, price per market). Prints through `window.print()`; `@page` size is injected per stock and `.noprint` hides the controls. Each variant has its own SKU and barcode (SKU column + More in the editor).

## Dropdowns
Never use a native `<select>` (the browser draws its list and it can't be styled). Use `components/Select.tsx`: same `<option>` children and `value` / `onChange={(e) => e.target.value}` as a select, but a custom trigger (`.selectbtn`, covered by every field theme in `fields.css`) and a portal list (`.selectpop`): check mark on the selected row, arrow/Home/End/Enter/Escape and type-ahead, a search box when there are more than 8 options, flips upward near the bottom of the screen, storefront colours when inside `.store`. The trigger carries `iconbtn` only to skip button hover effects, so its size is forced in `styles.css`.

## Customers list
`components/admin/Customers.tsx` mirrors Shopify's list: search, filter chips (stand-in for the AI segment bar), sort + column picker (`ColumnsMenu`: eye toggles, drag or ↑/↓ to reorder; view saved in localStorage key `customers.view.v1`), row selection, 50-per-page paging via `GET /api/admin/customers?q&filter&sort&dir&limit&offset` → `{items,total}`. Export uses `download()` (authenticated blob). Import (`ImportCustomers`, `lib/csv.ts`) reads Shopify's customer CSV or our own export and posts 500-row chunks to `/customers/import`. To add a column, add one entry to `COLS` (and the field to `customerRows` in the backend if it isn't there yet).
- Global button/field rules use `:where(...)` so component styles (icon buttons, chips, list rows) can override them. Don't re-add `:not()` chains with higher specificity.

## Motion and overlays
- `Modal` (centered dialogs) and `Drawer` (right panel for long forms) are the only overlay components; both close on Escape, `dismissOnScrim={false}` protects typed data. Nested dialogs sit above (`.modal-scrim` z-index > `.drawer-scrim`).
- All field/button motion lives in the "motion" block at the end of `styles.css` (hover border, blue focus ring + label, press/lift on buttons, dropdown/dialog/drawer entrances). It is disabled under `prefers-reduced-motion`. New form controls inherit it automatically; don't add per-component transitions.

## Commands
- `npm -w frontend run dev:web` (port 5173), `build`, `typecheck`
