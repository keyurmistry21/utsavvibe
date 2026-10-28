import Link from "next/link";
import { notFound } from "next/navigation";
import { fromPrice, getMarkets, getProducts, getSite } from "@/lib/store";
import { money } from "@/lib/api";
import { ProductArt } from "@/components/store/ProductArt";

export async function generateMetadata({ params }: { params: Promise<{ market: string }> }) {
  const { market } = await params;
  const site = await getSite();
  return { title: site.metaTitle || `${site.storeName} — Festive & devotional gifts (${market.toUpperCase()})`, ...(site.metaDescription ? { description: site.metaDescription } : {}) };
}

export default async function MarketHome({ params }: { params: Promise<{ market: string }> }) {
  const { market } = await params;
  const [products, markets] = await Promise.all([getProducts(market.toUpperCase()), getMarkets()]);
  const current = markets.find((m) => m.code.toLowerCase() === market.toLowerCase());
  if (!products || !current) notFound();
  const free = current.shippingRates[0]?.freeOverAmount;

  return (
    <>
      <section className="hero">
        <div>
          <p className="eyebrow">Festive season · {current.name}</p>
          <h1>Celebrate every ritual,<br />beautifully.</h1>
          <p className="sub">Handpicked idols, diyas, rakhis and pooja essentials, priced in {current.currency} and delivered to your door.</p>
          <a href="#shop" className="btn">Shop the collection</a>
        </div>
        <div className="hero-art" aria-hidden="true"><i /><i /><i /></div>
      </section>

      <section className="trust">
        <div><b>{free != null ? `Free shipping over ${money(free, current.currency)}` : "Tracked delivery"}</b><span>Tracked to your door</span></div>
        <div><b>{current.taxInclusive ? "Tax included" : "Clear pricing"}</b><span>{current.taxInclusive ? "No surprises at checkout" : "Tax shown before you pay"}</span></div>
        <div><b>Secure checkout</b><span>Powered by Stripe</span></div>
      </section>

      <section id="shop">
        <h2 className="sec">Shop all</h2>
        {products.length ? (
          <div className="pgrid">
            {products.map((p) => {
              const from = fromPrice(p);
              const sold = p.variants.every((v) => !v.inStock);
              return (
                <Link key={p.id} href={`/${market}/products/${p.handle}`} className="pcard">
                  <div className="pimg">
                    {p.images[0] ? <img src={p.images[0].thumbUrl} alt={p.images[0].alt || p.title} loading="lazy" /> : <ProductArt title={p.title} />}
                    {sold && <span className="tag-sold">Sold out</span>}
                  </div>
                  <div className="pinfo">
                    <span className="ptitle">{p.title}</span>
                    <span className="pprice">{from != null && `${p.variants.length > 1 ? "From " : ""}${money(from, p.currency)}`}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="sf-empty">
            <h3>Nothing here yet</h3>
            <p>No products are available in {current.name} right now. Check back soon.</p>
          </div>
        )}
      </section>
    </>
  );
}
