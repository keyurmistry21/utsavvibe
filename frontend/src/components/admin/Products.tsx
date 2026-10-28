"use client";

import { useEffect, useState } from "react";
import { api, type Market, type Product } from "@/lib/api";
import { blank, fromProduct, ProductEditor, type Form } from "./ProductEditor";
import { ProductList } from "./ProductList";
import { useApi } from "./hooks";

export function Products() {
  const { data: markets } = useApi<Market[]>("/markets");
  const [form, setForm] = useState<Form | null>(null);
  const [loadErr, setLoadErr] = useState("");
  // /admin/products?new=1 opens the add-product page straight away
  useEffect(() => {
    if (markets && new URLSearchParams(location.search).get("new")) {
      history.replaceState(null, "", location.pathname);
      setForm(blank());
    }
  }, [markets]);

  const edit = async (id: string) => {
    setLoadErr("");
    try { setForm(fromProduct(await api<Product>(`/products/${id}`))); } catch (e) { setLoadErr((e as Error).message); }
  };

  if (form && markets) return <ProductEditor key={form.id ?? "new"} markets={markets} initial={form} onDone={() => setForm(null)} />;
  return (
    <>
      {loadErr && <div className="error">{loadErr}</div>}
      <ProductList onAdd={() => setForm(blank())} onEdit={edit} />
    </>
  );
}
