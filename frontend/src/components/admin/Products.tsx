"use client";

import { useEffect, useState } from "react";
import { api, money, toMajor, toMinor, uploadImage, type Market, type Product, type ProductImage, type Variant } from "@/lib/api";
import { ImageManager, type Pending } from "./ImageManager";
import { Badge, TagList, useApi } from "./hooks";
import { Plus } from "../Icons";

type VForm = {
  id?: string; title: string; optionsText: string; sku: string; inventory: string;
  prices: Record<string, { amount: string; compareAt: string }>;
};
type Form = {
  id?: string; title: string; description: string; status: Product["status"];
  tagsText: string; notes: string; marketIds: string[]; regions: Record<string, string[]>; images: ProductImage[]; variants: VForm[];
};

const blankVariant = (): VForm => ({ title: "Default", optionsText: "", sku: "", inventory: "0", prices: {} });
const blank = (): Form => ({ title: "", description: "", status: "draft", tagsText: "", notes: "", marketIds: [], regions: {}, images: [], variants: [blankVariant()] });

const parseOptions = (s: string) =>
  Object.fromEntries(s.split(",").map((p) => p.split("=").map((x) => x.trim())).filter(([k, v]) => k && v));

const fromProduct = (p: Product): Form => ({
  id: p.id, title: p.title, description: p.description, status: p.status, tagsText: p.tags.join(", "), notes: p.notes, marketIds: p.marketIds, regions: p.regions ?? {}, images: p.images ?? [],
  variants: p.variants.map((v: Variant) => ({
    id: v.id, title: v.title, sku: v.sku ?? "", inventory: String(v.inventory),
    optionsText: Object.entries(v.options).map(([k, x]) => `${k}=${x}`).join(", "),
    prices: Object.fromEntries(Object.entries(v.prices).map(([m, p]) => [m, { amount: toMajor(p.amount), compareAt: toMajor(p.compareAt ?? undefined) }])),
  })),
});

function ProductForm({ markets, initial, onDone }: { markets: Market[]; initial: Form; onDone: () => void }) {
  const [f, setF] = useState(initial);
  const [err, setErr] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const selected = markets.filter((m) => f.marketIds.includes(m.id));

  const setVariant = (i: number, patch: Partial<VForm>) => setF({ ...f, variants: f.variants.map((v, j) => (j === i ? { ...v, ...patch } : v)) });
  const setPrice = (i: number, mid: string, key: "amount" | "compareAt", val: string) =>
    setVariant(i, { prices: { ...f.variants[i].prices, [mid]: { ...{ amount: "", compareAt: "" }, ...f.variants[i].prices[mid], [key]: val } } });
  const toggleMarket = (id: string) =>
    setF({ ...f, marketIds: f.marketIds.includes(id) ? f.marketIds.filter((x) => x !== id) : [...f.marketIds, id] });

  const save = async () => {
    setErr("");
    const body = {
      title: f.title, description: f.description, status: f.status, notes: f.notes, marketIds: f.marketIds,
      regions: Object.fromEntries(f.marketIds.map((m) => [m, f.regions[m] ?? []])),
      tags: f.tagsText.split(",").map((t) => t.trim()).filter(Boolean),
      variants: f.variants.map((v) => ({
        id: v.id, title: v.title || "Default", options: parseOptions(v.optionsText), sku: v.sku || null, inventory: parseInt(v.inventory || "0"),
        // only send prices for selected markets
        prices: Object.fromEntries(
          f.marketIds.map((mid) => {
            const p = v.prices[mid];
            return [mid, { amount: toMinor(p?.amount ?? ""), compareAt: p?.compareAt ? toMinor(p.compareAt) : null }];
          }),
        ),
      })),
    };
    try {
      const saved = await api<Product>(f.id ? `/products/${f.id}` : "/products", { method: f.id ? "PUT" : "POST", json: body });
      const failed: Pending[] = [];
      const errors: string[] = [];
      for (const p of pending) {
        try { await uploadImage(saved.id, p.file); } catch (e) { failed.push(p); errors.push(`${p.file.name}: ${(e as Error).message}`); }
      }
      if (failed.length) {
        // product is saved; stay on the form (now in edit mode) so the failed files can be retried
        const fresh = await api<Product>(`/products/${saved.id}`);
        setF({ ...f, id: saved.id, images: fresh.images });
        setPending(failed);
        setErr(`Product saved, but ${failed.length} image(s) failed: ${errors.join("; ")}`);
        return;
      }
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <>
      <h2>{f.id ? "Edit product" : "Add product"}</h2>
      <div className="card">
        <div className="field"><label>Title</label><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
        <div className="field"><label>Description</label><textarea rows={4} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
        <div className="row">
          <div className="field"><label>Status</label>
            <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as Product["status"] })}>
              <option value="draft">Draft</option><option value="active">Active</option><option value="archived">Archived</option>
            </select>
          </div>
          <div className="field"><label>Tags (comma separated)</label><input value={f.tagsText} onChange={(e) => setF({ ...f, tagsText: e.target.value })} /></div>
        </div>
        <div className="field"><label>Internal notes (not shown to customers)</label><textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
      </div>

      <ImageManager productId={f.id} images={f.images} onImages={(images) => setF((cur) => ({ ...cur, images }))} pending={pending} onPending={setPending} />

      <div className="card">
        <h3>Sell in markets</h3>
        <div className="checks">
          {markets.filter((m) => m.active).map((m) => (
            <label key={m.id}>
              <input type="checkbox" checked={f.marketIds.includes(m.id)} onChange={() => toggleMarket(m.id)} />
              {m.name} ({m.currency})
            </label>
          ))}
        </div>
        {selected.filter((m) => m.regions.length).map((m) => {
          const all = m.regions.map((r) => r.code);
          const sel = f.regions[m.id]?.length ? f.regions[m.id] : all;
          const toggle = (code: string) => {
            const next = sel.includes(code) ? sel.filter((c) => c !== code) : [...sel, code];
            if (!next.length) return; // must sell somewhere
            setF({ ...f, regions: { ...f.regions, [m.id]: next.length === all.length ? [] : next } });
          };
          return (
            <div key={m.id} className="regions">
              <h4>{m.name}: which {m.code === "US" ? "states" : "provinces"}? <span className="muted">Tax differs by region and is applied at checkout.</span></h4>
              <div className="checks">
                {m.regions.map((r) => (
                  <label key={r.code}>
                    <input type="checkbox" checked={sel.includes(r.code)} onChange={() => toggle(r.code)} />
                    {r.name} <span className="muted">{r.taxRateBps / 100}%</span>
                  </label>
                ))}
              </div>
              <button className="link" onClick={() => setF({ ...f, regions: { ...f.regions, [m.id]: [] } })}>Select all</button>
              {" · "}
              <span className="muted">{sel.length === all.length ? "Sold everywhere in " + m.name : `${sel.length} of ${all.length} selected`}</span>
            </div>
          );
        })}
        {!!selected.length && (
          <p className="muted">
            {selected.map((m) => `${m.code}: ${m.taxInclusive ? "tax included in price" : `tax ${m.taxRateBps / 100}% added at checkout`}`).join(" · ")}. Shipping is set per market under Markets.
          </p>
        )}
      </div>

      <div className="card">
        <h3>Variants & prices</h3>
        {f.variants.map((v, i) => (
          <div key={i} className="card" style={{ background: "#fafafb" }}>
            <div className="row">
              <div className="field"><label>Variant name</label><input value={v.title} onChange={(e) => setVariant(i, { title: e.target.value })} /></div>
              <div className="field"><label>Options (Size=M, Color=Red)</label><input value={v.optionsText} onChange={(e) => setVariant(i, { optionsText: e.target.value })} /></div>
              <div className="field"><label>SKU</label><input value={v.sku} onChange={(e) => setVariant(i, { sku: e.target.value })} /></div>
              <div className="field"><label>Stock</label><input type="number" min={0} value={v.inventory} onChange={(e) => setVariant(i, { inventory: e.target.value })} /></div>
            </div>
            <div className="row">
              {selected.map((m) => (
                <div key={m.id} className="field">
                  <label>{m.code} price ({m.currency})</label>
                  <input type="number" step="0.01" min={0} placeholder="0.00" value={v.prices[m.id]?.amount ?? ""} onChange={(e) => setPrice(i, m.id, "amount", e.target.value)} />
                  <input type="number" step="0.01" min={0} placeholder="compare-at (optional)" style={{ marginTop: 4 }} value={v.prices[m.id]?.compareAt ?? ""} onChange={(e) => setPrice(i, m.id, "compareAt", e.target.value)} />
                </div>
              ))}
              {!selected.length && <span className="muted">Select a market above to set prices.</span>}
            </div>
            {f.variants.length > 1 && <button className="link" onClick={() => setF({ ...f, variants: f.variants.filter((_, j) => j !== i) })}>Remove variant</button>}
          </div>
        ))}
        <button onClick={() => setF({ ...f, variants: [...f.variants, { ...blankVariant(), title: "" }] })}><Plus />Add variant</button>
      </div>

      {err && <div className="error">{err}</div>}
      <button className="primary" onClick={save}>Save product</button>{" "}
      <button onClick={onDone}>Cancel</button>
    </>
  );
}

export function Products() {
  const { data: markets } = useApi<Market[]>("/markets");
  const { data: products, error, reload } = useApi<Product[]>("/products");
  const [form, setForm] = useState<Form | null>(null);
  // /admin/products?new=1 opens the add-product form straight away
  useEffect(() => {
    if (markets && new URLSearchParams(location.search).get("new")) {
      history.replaceState(null, "", location.pathname);
      setForm(blank());
    }
  }, [markets]);

  if (form && markets)
    return <ProductForm markets={markets} initial={form} onDone={() => { setForm(null); reload(); }} />;

  const byId = Object.fromEntries((markets ?? []).map((m) => [m.id, m]));
  return (
    <>
      <div className="pagehead">
        <h2>Products</h2>
        <button className="primary" onClick={() => setForm(blank())}>Add product</button>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="card">
        <table>
          <thead><tr><th style={{ width: 56 }}></th><th>Product</th><th>Status</th><th>Markets / prices (from)</th><th>Stock</th><th>Tags</th></tr></thead>
          <tbody>
            {products?.map((p) => (
              <tr key={p.id}>
                <td>{p.images?.[0] ? <img className="listthumb" src={p.images[0].thumbUrl} alt="" /> : <span className="listthumb noimg" />}</td>
                <td><button className="link" onClick={() => setForm(fromProduct(p))}>{p.title}</button></td>
                <td><Badge value={p.status} /></td>
                <td>
                  {p.marketIds.map((mid) => {
                    const m = byId[mid];
                    const min = Math.min(...p.variants.map((v) => v.prices[mid]?.amount ?? Infinity));
                    return m && isFinite(min) ? <div key={mid}>{m.code} {money(min, m.currency)}</div> : null;
                  })}
                </td>
                <td>{p.variants.reduce((s, v) => s + v.inventory, 0)}</td>
                <td><TagList tags={p.tags} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
