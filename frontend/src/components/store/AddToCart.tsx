"use client";

import Link from "next/link";
import { useState } from "react";
import { money } from "@/lib/api";
import type { StoreProduct } from "@/lib/store";
import { useCart } from "./cart";
import { ArrowRight } from "../Icons";
import { track } from "@/lib/track";
import { usePdpImage } from "./PdpImage";

export function AddToCart({ product, market, highlight }: { product: StoreProduct; market: string; highlight?: string }) {
  const { add } = useCart();
  const [added, setAdded] = useState<string | null>(null);
  const { set: showImage } = usePdpImage();

  return (
    <div className="card">
      {product.variants.map((v) => (
        <div key={v.id} onMouseEnter={() => v.imageUrl && showImage(v.imageUrl)} onClick={() => v.imageUrl && showImage(v.imageUrl)} className={`row ${highlight === v.id && product.variants.length > 1 ? "vhit" : ""}`} style={{ justifyContent: "space-between", marginBottom: 8 }}>
          <span>{v.imageUrl && product.variants.length > 1 && <img src={v.imageUrl} alt="" width={36} height={36} style={{ objectFit: "cover", borderRadius: 6, marginRight: 8, verticalAlign: "middle" }} />}{product.variants.length > 1 ? v.title : "Price"}{highlight === v.id && product.variants.length > 1 && <em className="vhit-tag">Scanned</em>}{v.inStock && v.stockLeft != null && <em className="lowstock">Only {v.stockLeft} left</em>}</span>
          <span className="price">
            {v.price != null && money(v.price, product.currency)}
          </span>
          <button
            className="primary"
            style={{ flex: "none" }}
            disabled={!v.inStock || v.price == null}
            onClick={() => {
              add({ variantId: v.id, title: v.title === "Default" ? product.title : `${product.title} — ${v.title}`, image: v.imageUrl ?? product.images[0]?.thumbUrl });
              setAdded(v.id);
              track("add_to_cart", { data: { currency: product.currency, value: (v.price ?? 0) / 100, items: [{ item_id: v.id, item_name: product.title, price: (v.price ?? 0) / 100, quantity: 1 }] } });
            }}
          >
            {v.inStock ? (added === v.id ? "Added ✓" : "Add to cart") : "Sold out"}
          </button>
        </div>
      ))}
      {added && <Link href={`/${market}/cart`}>View cart<ArrowRight /></Link>}
    </div>
  );
}
