"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

export type CartLine = { variantId: string; title: string; quantity: number };
type CartCtx = {
  lines: CartLine[];
  count: number;
  add: (l: Omit<CartLine, "quantity">, qty?: number) => void;
  setQty: (variantId: string, qty: number) => void;
  clear: () => void;
};

const Ctx = createContext<CartCtx | null>(null);
// Cart is per market: variants and prices differ between markets, so don't mix them.
const key = (market: string) => `cart:${market}`;

export function CartProvider({ market, children }: { market: string; children: React.ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      setLines(JSON.parse(localStorage.getItem(key(market)) ?? "[]"));
    } catch {}
    setReady(true);
  }, [market]);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(key(market), JSON.stringify(lines));
    } catch {}
  }, [lines, ready, market]);

  const add = useCallback<CartCtx["add"]>((l, qty = 1) => {
    setLines((cur) => {
      const hit = cur.find((x) => x.variantId === l.variantId);
      return hit ? cur.map((x) => (x === hit ? { ...x, quantity: Math.min(99, x.quantity + qty) } : x)) : [...cur, { ...l, quantity: qty }];
    });
  }, []);
  const setQty = useCallback((variantId: string, qty: number) => {
    setLines((cur) => (qty <= 0 ? cur.filter((x) => x.variantId !== variantId) : cur.map((x) => (x.variantId === variantId ? { ...x, quantity: Math.min(99, qty) } : x))));
  }, []);
  const clear = useCallback(() => setLines([]), []);

  return <Ctx.Provider value={{ lines, count: lines.reduce((s, l) => s + l.quantity, 0), add, setQty, clear }}>{children}</Ctx.Provider>;
}

export const useCart = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCart outside CartProvider");
  return c;
};
