import Link from "next/link";
import { fromPrice, type StoreProduct } from "@/lib/store";
import { money } from "@/lib/api";
import { ProductArt } from "./ProductArt";

export function ProductGrid({ market, products }: { market: string; products: StoreProduct[] }) {
  return (
    <div className="pgrid">
      {products.map((p) => {
        const from = fromPrice(p);
        const sold = p.variants.every((v) => !v.inStock);
        return (
          <Link key={p.id} href={`/${market}/products/${p.handle}`} className="pcard">
            <div className="pimg">
              {p.images[0] ? <img src={p.images[0].thumbUrl} alt={p.images[0].alt || p.title} width={600} height={600} loading="lazy" /> : <ProductArt title={p.title} />}
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
  );
}
