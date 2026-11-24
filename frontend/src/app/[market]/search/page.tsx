import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { fromPrice, getMarkets, getProducts, type StoreProduct } from "@/lib/store";
import { ProductGrid } from "@/components/store/ProductGrid";

export const metadata: Metadata = { title: "Search", robots: { index: false, follow: true } };

type SP = { q?: string; sort?: string; min?: string; max?: string; stock?: string };
const SORTS: [string, string][] = [["relevance", "Best match"], ["price_asc", "Price: low to high"], ["price_desc", "Price: high to low"], ["title", "Name A to Z"]];

// How well a product matches every word typed: title hits count most, then tags, SKU, and description.
function score(p: StoreProduct, words: string[]) {
  let total = 0;
  const title = p.title.toLowerCase(), tags = p.tags.join(" ").toLowerCase(), desc = (p.description ?? "").toLowerCase();
  const skus = p.variants.map((v) => `${v.sku ?? ""} ${v.barcode ?? ""} ${v.title}`).join(" ").toLowerCase();
  for (const w of words) {
    const s = (title.includes(w) ? 10 : 0) + (tags.includes(w) ? 4 : 0) + (skus.includes(w) ? 4 : 0) + (desc.includes(w) ? 1 : 0);
    if (!s) return 0; // every word has to match something
    total += s;
  }
  return total;
}

export default async function Search({ params, searchParams }: { params: Promise<{ market: string }>; searchParams: Promise<SP> }) {
  const { market } = await params;
  const sp = await searchParams;
  const markets = await getMarkets();
  const m = markets.find((x) => x.code.toLowerCase() === market.toLowerCase());
  if (!m) notFound();
  const all = (await getProducts(m.code)) ?? [];
  const q = (sp.q ?? "").trim().slice(0, 80);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const min = sp.min ? Math.round(parseFloat(sp.min) * 100) : null, max = sp.max ? Math.round(parseFloat(sp.max) * 100) : null;
  const sort = SORTS.some(([k]) => k === sp.sort) ? sp.sort! : "relevance";

  let rows = all.map((p) => ({ p, s: words.length ? score(p, words) : 1 })).filter((r) => r.s > 0);
  if (sp.stock === "1") rows = rows.filter((r) => r.p.variants.some((v) => v.inStock));
  if (min != null && !isNaN(min)) rows = rows.filter((r) => (fromPrice(r.p) ?? 0) >= min);
  if (max != null && !isNaN(max)) rows = rows.filter((r) => (fromPrice(r.p) ?? 0) <= max);
  rows.sort((a, b) => (sort === "price_asc" ? (fromPrice(a.p) ?? 0) - (fromPrice(b.p) ?? 0) : sort === "price_desc" ? (fromPrice(b.p) ?? 0) - (fromPrice(a.p) ?? 0) : sort === "title" ? a.p.title.localeCompare(b.p.title) : b.s - a.s));
  const results = rows.map((r) => r.p);

  return (
    <article className="sf-page">
      <p className="crumbs"><Link href={`/${market}`}>Shop</Link> / Search</p>
      <h1>{q ? `Results for “${q}”` : "All products"}</h1>
      <form action={`/${market}/search`} method="get" className="sf-searchform" role="search">
        <input name="q" defaultValue={q} placeholder="Search products, e.g. Ganesha, diya, rakhi" aria-label="Search products" />
        <select name="sort" defaultValue={sort} aria-label="Sort by">{SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <input name="min" defaultValue={sp.min ?? ""} inputMode="decimal" placeholder={`Min ${m.currency}`} aria-label="Minimum price" className="sf-narrow" />
        <input name="max" defaultValue={sp.max ?? ""} inputMode="decimal" placeholder={`Max ${m.currency}`} aria-label="Maximum price" className="sf-narrow" />
        <label className="sf-check"><input type="checkbox" name="stock" value="1" defaultChecked={sp.stock === "1"} /> In stock only</label>
        <button type="submit" className="primary">Search</button>
      </form>
      <p className="muted">{results.length} product{results.length === 1 ? "" : "s"}</p>
      {results.length ? <ProductGrid market={market} products={results} /> : <p>Nothing matched. Try fewer words, or <Link href={`/${market}/search`}>see everything</Link>.</p>}
    </article>
  );
}
