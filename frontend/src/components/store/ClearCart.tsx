"use client";

import { useEffect } from "react";
import { useCart } from "./cart";
import { track } from "@/lib/track";

// Rendered on the post-payment page so the cart empties after a successful redirect.
export function ClearCart({ order }: { order?: string }) {
  const { clear } = useCart();
  useEffect(clear, [clear]);
  // one purchase event per order per browser session (reloading the page must not count twice)
  useEffect(() => {
    if (!order) return;
    try { if (sessionStorage.getItem(`uv_buy_${order}`)) return; sessionStorage.setItem(`uv_buy_${order}`, "1"); } catch { /* still count once per load */ }
    track("purchase", { data: { transaction_id: order } });
  }, [order]);
  return null;
}
