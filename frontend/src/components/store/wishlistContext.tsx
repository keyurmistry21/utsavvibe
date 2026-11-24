"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

// Saved products, kept on this device (no account needed). Product ids are the same in every market.
const KEY = "wishlist:v1";
type Ctx = { ids: string[]; has: (id: string) => boolean; toggle: (id: string) => void };
const C = createContext<Ctx | null>(null);

export function WishlistProvider({ children }: { children: React.ReactNode }) {
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => { try { setIds(JSON.parse(localStorage.getItem(KEY) ?? "[]")); } catch {} }, []);
  const save = (n: string[]) => { try { localStorage.setItem(KEY, JSON.stringify(n)); } catch {} };
  const toggle = useCallback((id: string) => setIds((cur) => { const n = cur.includes(id) ? cur.filter((x) => x !== id) : [id, ...cur].slice(0, 100); save(n); return n; }), []);
  return <C.Provider value={{ ids, has: (id) => ids.includes(id), toggle }}>{children}</C.Provider>;
}

export const useWishlist = () => {
  const c = useContext(C);
  if (!c) throw new Error("useWishlist outside WishlistProvider");
  return c;
};

export function WishButton({ id, title, className = "" }: { id: string; title: string; className?: string }) {
  const { has, toggle } = useWishlist();
  const on = has(id);
  return (
    <button type="button" className={`wish ${on ? "on" : ""} ${className}`} aria-pressed={on} aria-label={on ? `Remove ${title} from wishlist` : `Add ${title} to wishlist`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle(id); }}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M12 20.5s-7.5-4.6-9.2-9.3C1.7 8 3.6 5 6.7 5c1.9 0 3.4 1 5.3 3 1.9-2 3.4-3 5.3-3 3.1 0 5 3 3.9 6.2-1.7 4.7-9.2 9.3-9.2 9.3z" /></svg>
    </button>
  );
}

export function WishLink({ market }: { market: string }) {
  const { ids } = useWishlist();
  return (
    <a href={`/${market}/wishlist`} className="sf-wish" aria-label={`Wishlist, ${ids.length} saved`}>
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M12 20.5s-7.5-4.6-9.2-9.3C1.7 8 3.6 5 6.7 5c1.9 0 3.4 1 5.3 3 1.9-2 3.4-3 5.3-3 3.1 0 5 3 3.9 6.2-1.7 4.7-9.2 9.3-9.2 9.3z" /></svg>
      {ids.length > 0 && <b>{ids.length}</b>}
    </a>
  );
}
