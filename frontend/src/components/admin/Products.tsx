"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ProductList } from "./ProductList";

// Handles that match a fixed page (labels, import, scan, new) are reached through /edit/<handle>.
const RESERVED = new Set(["new", "labels", "import", "scan", "edit"]);

// The list. Add and edit open their own addresses: /admin/products/new and /admin/products/<handle>.
export function Products() {
  const router = useRouter();
  // old link /admin/products?new=1
  useEffect(() => { if (new URLSearchParams(location.search).get("new")) router.replace("/admin/products/new"); }, [router]);
  return <ProductList onAdd={() => router.push("/admin/products/new")} onEdit={(handle) => router.push(`/admin/products/${RESERVED.has(handle) ? `edit/${handle}` : handle}`)} />;
}
