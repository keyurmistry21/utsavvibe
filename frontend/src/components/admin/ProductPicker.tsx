"use client";

import { useMemo, useState } from "react";
import { money, type Market, type Product } from "@/lib/api";
import { Modal } from "./Modal";

export type Picked = { variantId: string; title: string; price: number };

// Searchable catalog for the market; tick variants, then add them all at once.
export function ProductPicker({ products, market, inOrder, onAdd, onClose }: {
  products: Product[];
  market: Market;
  inOrder: Set<string>;
  onAdd: (items: Picked[]) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Record<string, Picked>>({});

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return products
      .filter((p) => p.status !== "archived" && p.marketIds.includes(market.id))
      .filter((p) => !needle || [p.title, ...p.tags, ...p.variants.flatMap((v) => [v.title, v.sku ?? ""])].some((t) => t.toLowerCase().includes(needle)));
  }, [products, market.id, q]);

  const toggle = (p: Product, v: Product["variants"][number]) => {
    const price = v.prices[market.id]?.amount;
    if (price == null) return;
    const id = v.id!;
    setSel((cur) => {
      const next = { ...cur };
      if (next[id]) delete next[id];
      else next[id] = { variantId: id, title: v.title === "Default" ? p.title : `${p.title} — ${v.title}`, price };
      return next;
    });
  };
  const count = Object.keys(sel).length;

  return (
    <Modal
      title="Add products"
      onClose={onClose}
      footer={
        <>
          <span className="muted">{count ? `${count} variant${count === 1 ? "" : "s"} selected` : "Select products to add"}</span>
          <span style={{ display: "flex", gap: 8 }}>
            <button onClick={onClose}>Cancel</button>
            <button className="primary" disabled={!count} onClick={() => onAdd(Object.values(sel))}>Add</button>
          </span>
        </>
      }
    >
      <input autoFocus className="pickersearch" placeholder="Search products, variants, SKU or tags" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="pickerlist">
        {list.map((p) => (
          <div key={p.id} className="pickprod">
            <div className="pickhead">
              {p.images?.[0] ? <img className="listthumb" src={p.images[0].thumbUrl} alt="" /> : <span className="listthumb noimg" />}
              <b>{p.title}</b>
              {p.status === "draft" && <span className="badge">draft</span>}
            </div>
            {p.variants.map((v) => {
              const price = v.prices[market.id]?.amount;
              const on = !!sel[v.id!];
              return (
                <label key={v.id} className={`pickvar ${price == null ? "off" : ""}`}>
                  <input type="checkbox" checked={on} disabled={price == null} onChange={() => toggle(p, v)} />
                  <span className="vt">{v.title === "Default" ? "Default" : v.title}{inOrder.has(v.id!) && <em> · in order</em>}</span>
                  <span className="muted">{v.inventory > 0 ? `${v.inventory} available` : "Out of stock"}</span>
                  <span className="vp">{price != null ? money(price, market.currency) : "No price"}</span>
                </label>
              );
            })}
          </div>
        ))}
        {!list.length && <p className="muted" style={{ padding: 16 }}>{q ? `No products match “${q}”.` : `No products are sold in ${market.name} yet.`}</p>}
      </div>
    </Modal>
  );
}
