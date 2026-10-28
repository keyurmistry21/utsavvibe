---
name: frontend
description: Work on the UtsavVibe frontend (Next.js App Router). Use when building or changing the SSR storefront (products, cart, checkout UI), the admin dashboard pages, navigation, or styling.
---

Read `frontend/CLAUDE.md` first, then follow the matching recipe.

## Add an admin page
1. Create `frontend/src/components/admin/<Name>.tsx` starting with `"use client"`; fetch with `useApi<T>("/path")` or `api()` from `@/lib/api`.
2. Add `frontend/src/app/admin/<name>/page.tsx` that renders it.
3. Add it to `links` (and optionally `actions`) in `components/admin/nav.ts` so it appears in the sidebar and ⌘K search.
4. Reuse existing classes: `pagehead`, `card`, `row`, `field`, `primary`, `link`, `Badge`, `TagList`. Cards that contain only a table get the flush table style automatically.

## Add or change a storefront page
1. Put it under `src/app/[market]/…` as a server component; fetch via `src/lib/store.ts` (add a backend `/api/store/...` endpoint first if needed). Call `notFound()` for unknown market/product.
2. Export `generateMetadata` for SEO. Format prices with `money(minor, currency)`.
3. Interactive parts (cart, buttons with state) go in small client components under `src/components/store/`.
4. Never compute totals client-side; use `/api/store/quote`.

## Styling
All CSS is in `src/app/styles.css`. Admin rules are prefixed `.admin`, storefront `.store`. Admin look: black sidebar, white rounded content panel (grey background on inner pages, white on Home), badges (`good`, `warn`, `bad`).

## Verify
1. `npm -w frontend run typecheck` and `npx next build` (from `frontend/`) must pass.
2. For visual work run `make up` and look at the page. Headless screenshots: `playwright-core` with the Chrome binary, log in at `/admin`, screenshot to the scratchpad directory.
3. SSR check: `curl localhost:5173/uk` should contain the product title in raw HTML.
