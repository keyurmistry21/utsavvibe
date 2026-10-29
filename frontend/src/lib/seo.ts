import type { StoreMarket } from "./store";

/** Public origin of the storefront (no trailing slash). The Online Store preference `publicUrl` wins, then env, then dev. */
export const siteOrigin = (publicUrl?: string) =>
  (publicUrl || process.env.NEXT_PUBLIC_SITE_URL || process.env.STOREFRONT_URL || "http://localhost:5173").replace(/\/+$/, "");

export const absUrl = (origin: string, path: string) => (/^https?:\/\//i.test(path) ? path : `${origin}${path.startsWith("/") ? "" : "/"}${path}`);

/** hreflang for a market: UK → en-GB, others en-<CODE>. */
export const hreflang = (code: string) => `en-${code.toUpperCase() === "UK" ? "GB" : code.toUpperCase()}`;

/** Canonical + hreflang alternates for a page that exists in `markets` (paths are relative to the market, e.g. "/products/x"). */
export function marketAlternates(origin: string, current: string, markets: Pick<StoreMarket, "code">[], path: string) {
  const at = (code: string) => `${origin}/${code.toLowerCase()}${path}`;
  const languages: Record<string, string> = {};
  if (markets.length > 1) {
    for (const m of markets) languages[hreflang(m.code)] = at(m.code);
    languages["x-default"] = at(markets[0].code);
  }
  return { canonical: at(current), ...(markets.length > 1 ? { languages } : {}) };
}

/** Major-unit price string for schema.org. */
export const priceStr = (minor: number) => (minor / 100).toFixed(2);
