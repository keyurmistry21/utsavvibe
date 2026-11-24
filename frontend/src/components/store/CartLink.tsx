"use client";

import Link from "next/link";
import { useCart } from "./cart";

export function CartLink({ market }: { market: string }) {
  const { count } = useCart();
  return <Link href={`/${market}/cart`} className="sf-cart" aria-label={`Cart, ${count} items`}><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 4h2l2.4 11h10.2L20 7H6.2" /><circle cx="9" cy="19.5" r="1.4" /><circle cx="17" cy="19.5" r="1.4" /></svg>{count > 0 && <b>{count}</b>}</Link>;
}
