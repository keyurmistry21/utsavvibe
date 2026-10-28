---
name: frontend
description: Work on the UtsavVibe frontend (Next.js App Router). Use when building or changing the SSR storefront (products, cart, checkout UI), the admin dashboard pages, navigation, or styling.
---

Read `frontend/CLAUDE.md` first, then follow the matching recipe.

## Add an admin page
1. Create `frontend/src/components/admin/<Name>.tsx` starting with `"use client"`; fetch with `useApi<T>("/path")` or `api()` from `@/lib/api`.
2. Add `frontend/src/app/admin/<name>/page.tsx` that renders it.
3. Add it to `links` (with its `perm`) and optionally `actions` in `components/admin/nav.ts`, and its path prefix to `ROUTE_PERMS` in `lib/perms.tsx` so the sidebar, ⌘K search and route guard all respect roles. The API must have the matching `guard()`.
4. Reuse existing classes: `pagehead`, `card`, `row`, `field`, `primary`, `link`, `Badge`, `TagList`. Cards that contain only a table get the flush table style automatically.

## Add a settings screen
Page file under `app/admin/settings/<name>/page.tsx`, component in `components/admin/`, an entry in `settingsLinks` (with `perm`, empty for everyone) and `ROUTE_PERMS`. Settings shows the main sidebar as an icon rail with the settings menu beside it (CSS transitions, see frontend/CLAUDE.md); don't render a second sidebar yourself.

## Build a form (validation is mandatory)
Compute an `errors` record from state with the validators in `lib/validators.ts`, pass it to `useValidation`, spread `val.props(key)` on each control, render `<FieldError k msg={val.err(key)} />` under it, and call `val.submit()` first in Save (it focuses the first invalid field and returns false). Map server conflicts (409/duplicates) back onto the field. Never disable Save for invalid input. Use `components/Select.tsx` instead of native selects, `Modal`/`Drawer` for overlays, `Switch` for toggles, `RichTextEditor` for HTML (sanitized by the API).

## Barcodes, SKUs, labels
`lib/codes.ts` (`makeSku`, `makeEan13`, `barcodeError`, `ean13Svg`), `CodePreview`, `PrintLabels` (`/admin/products/labels`). Generated barcodes use the GS1 internal range; real GTINs are typed in. Generation must check duplicates via `POST /products/codes/taken`.

## Add or change a storefront page
1. Put it under `src/app/[market]/…` as a server component; fetch via `src/lib/store.ts` (add a backend `/api/store/...` endpoint first if needed). Call `notFound()` for unknown market/product.
2. Export `generateMetadata` for SEO. Format prices with `money(minor, currency)`.
3. Interactive parts (cart, buttons with state) go in small client components under `src/components/store/`.
4. Never compute totals client-side; use `/api/store/quote`.

## Styling rules that bit us
Admin CSS is `.admin`-scoped in `src/app/styles.css`; don't reuse short generic class names (`.lbl` = print label preview, sidebar text = `.navlbl`). Field looks come from `fields.css` (five switchable styles, default Filled); a new input type must be added to its selector list. Popups that must escape the sidebar or a scroll container use a portal into `.admin` with `position: fixed` (see `StoreSwitcher`, `Select`). Motion is CSS only and must honour `prefers-reduced-motion`. Check 390px width for horizontal overflow.

## Styling
All CSS is in `src/app/styles.css`. Admin rules are prefixed `.admin`, storefront `.store`. Admin look: black sidebar, white rounded content panel (grey background on inner pages, white on Home), badges (`good`, `warn`, `bad`).

## Verify
1. `npm -w frontend run typecheck` and `npx next build` (from `frontend/`) must pass.
2. For visual work run `make up` and look at the page. Headless screenshots: `playwright-core` with the Chrome binary, log in at `/admin`, screenshot to the scratchpad directory.
3. Drive it with Playwright (`playwright-core` + Chrome): log in, perform the flow, assert text and counts, screenshot, and look at the screenshot. Wait for hydration/animations before asserting. Storefront fetches are cached 15s (stale-while-revalidate), so reload twice after an admin change; pages and policies are fetched `no-store`.
4. Clean up every record the test created.
5. SSR check: `curl localhost:5173/uk` should contain the product title in raw HTML.
