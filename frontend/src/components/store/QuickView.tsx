"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { money } from "@/lib/api";
import type { StoreProduct } from "@/lib/store";
import { useCart } from "./cart";
import { WishButton } from "./wishlistContext";
import { track } from "@/lib/track";

// Pick a variant and add to cart without leaving the list.
export function QuickView({ product: p, market, onClose }: { product: StoreProduct; market: string; onClose: () => void }) {
  const { add } = useCart();
  const first = p.variants.find((v) => v.inStock) ?? p.variants[0];
  const [vid, setVid] = useState(first?.id ?? "");
  const [added, setAdded] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const v = p.variants.find((x) => x.id === vid) ?? first;
  const img = v?.imageUrl ?? p.images[0]?.url;

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    box.current?.focus();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", key);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", key); document.body.style.overflow = ""; prev?.focus(); };
  }, [onClose]);

  return (
    <div className="qv-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="qv" role="dialog" aria-modal="true" aria-label={`Quick view: ${p.title}`} tabIndex={-1} ref={box}>
        <button type="button" className="qv-x" aria-label="Close" onClick={onClose}>×</button>
        <div className="qv-img">{img ? <img src={img} alt={p.title} /> : <div className="qv-ph">{p.title.slice(0, 2).toUpperCase()}</div>}</div>
        <div className="qv-body">
          <h3>{p.title}</h3>
          {v?.price != null && <div className="qv-price">{money(v.price, p.currency)}{v.compareAt ? <s>{money(v.compareAt, p.currency)}</s> : null}</div>}
          <p className="qv-desc">{p.description.slice(0, 220)}{p.description.length > 220 ? "…" : ""}</p>
          {p.variants.length > 1 && (
            <div className="qv-opts" role="radiogroup" aria-label="Choose an option">
              {p.variants.map((x) => <button type="button" key={x.id} role="radio" aria-checked={x.id === vid} disabled={!x.inStock} className={x.id === vid ? "on" : ""} onClick={() => { setVid(x.id); setAdded(false); }}>{x.title}</button>)}
            </div>
          )}
          <div className="qv-actions">
            <button type="button" className="primary" disabled={!v?.inStock || v.price == null} onClick={() => {
              if (!v) return;
              add({ variantId: v.id, title: v.title === "Default" ? p.title : `${p.title} — ${v.title}`, image: v.imageUrl ?? p.images[0]?.thumbUrl });
              setAdded(true);
              track("add_to_cart", { data: { currency: p.currency, value: (v.price ?? 0) / 100, items: [{ item_id: v.id, item_name: p.title, price: (v.price ?? 0) / 100, quantity: 1 }] } });
            }}>{v?.inStock ? (added ? "Added ✓" : "Add to cart") : "Sold out"}</button>
            <WishButton id={p.id} title={p.title} />
            {added && <Link href={`/${market}/cart`} className="qv-link">View cart</Link>}
          </div>
          <Link href={`/${market}/products/${p.handle}`} className="qv-link">View full details</Link>
        </div>
      </div>
    </div>
  );
}
