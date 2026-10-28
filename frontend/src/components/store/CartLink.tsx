"use client";

import Link from "next/link";
import { useCart } from "./cart";

export function CartLink({ market }: { market: string }) {
  const { count } = useCart();
  return <Link href={`/${market}/cart`}>Cart ({count})</Link>;
}
