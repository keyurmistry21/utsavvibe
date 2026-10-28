"use client";

import { useEffect } from "react";
import { useCart } from "./cart";

// Rendered on the post-payment page so the cart empties after a successful redirect.
export function ClearCart() {
  const { clear } = useCart();
  useEffect(clear, [clear]);
  return null;
}
