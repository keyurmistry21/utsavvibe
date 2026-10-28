// Server-side data access for the storefront (runs in Next server components).
const BACKEND = process.env.BACKEND_URL ?? "http://localhost:4000";

export type StoreMarket = {
  id: string; code: string; name: string; currency: string; countries: string[];
  taxRateBps: number; taxInclusive: boolean;
  regions: { code: string; name: string; taxRateBps: number }[];
  shippingRates: { id: string; name: string; amount: number; freeOverAmount: number | null }[];
};
export type StoreVariant = {
  id: string; title: string; options: Record<string, string>; inStock: boolean; price: number | null; compareAt: number | null;
};
export type StoreProduct = {
  id: string; handle: string; title: string; description: string; descriptionHtml: string; seoTitle: string; seoDescription: string; tags: string[]; currency: string; regions: string[]; images: { url: string; thumbUrl: string; alt: string }[]; variants: StoreVariant[];
};

async function get<T>(path: string, fresh = false): Promise<T | null> {
  const res = await fetch(`${BACKEND}/api/store${path}`, fresh ? { cache: "no-store" } : { next: { revalidate: 15 } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`store api ${res.status}`);
  return res.json();
}

// The API response can be an older shape when it comes from Next's data cache, so fill in anything missing.
const escHtml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const normProduct = (p: StoreProduct): StoreProduct => ({ ...p, descriptionHtml: p.descriptionHtml ?? (p.description ? `<p>${escHtml(p.description)}</p>` : ""), seoTitle: p.seoTitle ?? "", seoDescription: p.seoDescription ?? "", images: p.images ?? [], regions: p.regions ?? [], tags: p.tags ?? [], variants: p.variants ?? [] });
const normMarket = (m: StoreMarket): StoreMarket => ({ ...m, regions: m.regions ?? [], shippingRates: m.shippingRates ?? [], countries: m.countries ?? [] });

export const getMarkets = async () => ((await get<StoreMarket[]>("/markets")) ?? []).map(normMarket);
export const getProducts = async (code: string) => (await get<StoreProduct[]>(`/markets/${code}/products`))?.map(normProduct) ?? null;
export const getProduct = async (code: string, handle: string) => {
  const p = await get<StoreProduct>(`/markets/${code}/products/${handle}`);
  return p ? normProduct(p) : null;
};

export const fromPrice = (p: StoreProduct) => {
  const prices = p.variants.map((v) => v.price).filter((x): x is number => x != null);
  return prices.length ? Math.min(...prices) : null;
};

export type Site = { storeName: string; announcement: string; tagline: string; metaTitle: string; metaDescription: string; headerMenu: { label: string; url: string }[]; footerMenu: { label: string; url: string }[] };
const defaultSite: Site = { storeName: "UtsavVibe", announcement: "", tagline: "Festive & devotional gifts for every celebration.", metaTitle: "", metaDescription: "", headerMenu: [{ label: "Shop", url: "/" }], footerMenu: [] };
// never let a CMS hiccup take the whole storefront down: fall back to the defaults
export const getSite = async (): Promise<Site> => {
  try { return { ...defaultSite, ...((await get<Site>("/site")) ?? {}) }; } catch { return defaultSite; }
};
export type CmsPage = { handle: string; title: string; content: string; seoTitle: string; seoDescription: string };
export const getPage = (handle: string) => get<CmsPage>(`/pages/${encodeURIComponent(handle)}`, true) // not cached: Next keeps a stale 200 forever when the page later becomes a 404 (hidden/deleted);
/** "/pages/about" is relative to the market being browsed; full links are left alone. */
export const menuHref = (code: string, url: string) => (url.startsWith("/") ? `/${code}${url === "/" ? "" : url}` : url);

export type PolicyLink = { key: string; title: string };
export const getPolicyLinks = async (): Promise<PolicyLink[]> => { try { return (await get<PolicyLink[]>("/policies", true)) ?? []; } catch { return []; } };
export const getPolicy = (key: string) => get<{ key: string; title: string; content: string }>(`/policies/${encodeURIComponent(key)}`, true);
