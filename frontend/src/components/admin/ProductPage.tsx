"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type Market, type Product } from "@/lib/api";
import { blank, fromProduct, ProductEditor, type Form } from "./ProductEditor";
import { useApi } from "./hooks";

/** The add / edit product screen at its own address: /admin/products/new and /admin/products/<id>. */
export function ProductPage({ id }: { id?: string }) {
  const router = useRouter();
  const { data: markets } = useApi<Market[]>("/markets");
  const [form, setForm] = useState<Form | null>(id ? null : blank());
  const [err, setErr] = useState("");
  useEffect(() => {
    if (!id) return;
    api<Product>(`/products/${id}`).then((p) => setForm(fromProduct(p))).catch((e) => setErr(e.message));
  }, [id]);

  const back = () => router.push("/admin/products");
  if (err) return <div className="error">{err.includes("not found") ? "That product doesn't exist (it may have been deleted)." : err} <button className="link" onClick={back}>Back to products</button></div>;
  if (!form || !markets) return <p className="muted">Loading…</p>;
  return <ProductEditor key={form.id ?? "new"} markets={markets} initial={form} onDone={back} />;
}
