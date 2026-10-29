import type { MetadataRoute } from "next";
import { getCollections, getMarkets, getPosts, getPolicyLinks, getProducts, getSite } from "@/lib/store";
import { absUrl, hreflang, siteOrigin } from "@/lib/seo";

// Built from live data on request; a backend hiccup must not break the build.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [site, markets, collections, posts, policies] = await Promise.all([getSite(), getMarkets().catch(() => []), getCollections(), getPosts(), getPolicyLinks()]);
  const origin = siteOrigin(site.publicUrl);
  const url = (code: string, path = "") => absUrl(origin, `/${code.toLowerCase()}${path}`);
  const out: MetadataRoute.Sitemap = [];

  // products can exist in several markets: list each with hreflang alternates to its siblings
  const perMarket = await Promise.all(markets.map(async (m) => ({ m, products: (await getProducts(m.code).catch(() => null)) ?? [] })));
  const handleMarkets = new Map<string, string[]>();
  for (const { m, products } of perMarket) for (const p of products) handleMarkets.set(p.handle, [...(handleMarkets.get(p.handle) ?? []), m.code]);
  const alternates = (path: string, codes: string[]) =>
    codes.length > 1 ? { languages: { ...Object.fromEntries(codes.map((c) => [hreflang(c), url(c, path)])), "x-default": url(codes[0], path) } } : undefined;

  for (const m of markets) {
    out.push({ url: url(m.code), changeFrequency: "daily", priority: 1, alternates: alternates("", markets.map((x) => x.code)) });
    out.push({ url: url(m.code, "/collections"), changeFrequency: "weekly", priority: 0.5 });
    if (posts.length) out.push({ url: url(m.code, "/blog"), changeFrequency: "weekly", priority: 0.5 });
  }
  for (const c of collections) {
    for (const m of markets) out.push({ url: url(m.code, `/collections/${c.handle}`), changeFrequency: "weekly", priority: 0.7, alternates: alternates(`/collections/${c.handle}`, markets.map((x) => x.code)) });
  }
  for (const [handle, codes] of handleMarkets) {
    for (const code of codes) out.push({ url: url(code, `/products/${handle}`), changeFrequency: "weekly", priority: 0.8, alternates: alternates(`/products/${handle}`, codes) });
  }
  // blog, CMS pages and policies read the same in every market: list them once, under the default market
  const def = markets[0]?.code;
  if (def) {
    for (const p of posts) out.push({ url: url(def, `/blog/${p.handle}`), lastModified: p.publishedAt, changeFrequency: "monthly", priority: 0.6 });
    for (const p of policies) out.push({ url: url(def, `/policies/${p.key}`), changeFrequency: "yearly", priority: 0.3 });
    const pages = new Set([...site.headerMenu, ...site.footerMenu].map((l) => /^\/pages\/([^/?#]+)/.exec(l.url)?.[1]).filter((h): h is string => !!h));
    for (const h of pages) out.push({ url: url(def, `/pages/${h}`), changeFrequency: "yearly", priority: 0.4 });
  }
  return out;
}
