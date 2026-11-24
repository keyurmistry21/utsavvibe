"use client";

import { useEffect, useState } from "react";
import type { StoreProduct } from "@/lib/store";
import { ProductGrid } from "./ProductGrid";
import { useWishlist } from "./wishlistContext";

// Saved products of this device, shown with this market's prices.
export function WishlistPage({ market }: { market: string }) {
  const { ids } = useWishlist();
  const [all, setAll] = useState<StoreProduct[] | null>(null);
  useEffect(() => {
    fetch(`/api/store/markets/${market.toUpperCase()}/products`).then((r) => (r.ok ? r.json() : [])).then(setAll).catch(() => setAll([]));
  }, [market]);
  const mine = (all ?? []).filter((p) => ids.includes(p.id));
  return (
    <>
      <h1 className="sec">Wishlist</h1>
      {all === null ? <p className="muted">Loading…</p> : mine.length ? <ProductGrid market={market} products={mine} /> : (
        <div className="sf-empty"><h3>Your wishlist is empty</h3><p>Tap the heart on any product to save it here. Saved items stay on this device.</p></div>
      )}
    </>
  );
}
