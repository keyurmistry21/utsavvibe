"use client";

import { useState } from "react";
import { api, toMajor, toMinor, uploadImage, type Market, type Product, type ProductImage } from "@/lib/api";
import { decimal, int, money } from "@/lib/validators";
import { barcodeError, makeEan13, makeSku } from "@/lib/codes";
import { CodePreview } from "./CodePreview";
import { FieldError, useValidation } from "./validation";
import { ArrowLeft, Plus } from "../Icons";
import { ImageManager, type Pending } from "./ImageManager";
import { RichTextEditor } from "./RichTextEditor";
import { Switch } from "./Switch";
import { Select } from "../Select";

export type OptionDef = { name: string; values: string[] };
type PriceForm = { amount: string; compareAt: string };
export type VForm = { id?: string; options: Record<string, string>; title: string; sku: string; barcode: string; inventory: string; weight: string; prices: Record<string, PriceForm> };
export type Form = {
  id?: string; title: string; description: string; status: Product["status"]; vendor: string; productType: string; tagsText: string; notes: string;
  marketIds: string[]; regions: Record<string, string[]>; images: ProductImage[];
  trackInventory: boolean; continueSelling: boolean; physical: boolean; chargeTax: boolean; isGiftCard: boolean;
  seoTitle: string; seoDescription: string; handle: string; handleTouched: boolean;
  options: OptionDef[]; variants: VForm[];
};

const UNIT_G = { kg: 1000, g: 1, lb: 453.592, oz: 28.3495 } as const;
type Unit = keyof typeof UNIT_G;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100);
const sigOf = (o: Record<string, string>) => JSON.stringify(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
const blankVariant = (): VForm => ({ options: {}, title: "Default", sku: "", barcode: "", inventory: "0", weight: "", prices: {} });

export const blank = (): Form => ({
  title: "", description: "", status: "draft", vendor: "", productType: "", tagsText: "", notes: "", marketIds: [], regions: {}, images: [],
  trackInventory: true, continueSelling: false, physical: true, chargeTax: true, isGiftCard: false, seoTitle: "", seoDescription: "", handle: "", handleTouched: false,
  options: [], variants: [blankVariant()],
});

const gramsToUnit = (g: number, unit: Unit) => (g ? String(Math.round((g / UNIT_G[unit]) * 1000) / 1000) : "");

export function fromProduct(p: Product): Form {
  const names: string[] = [];
  p.variants.forEach((v) => Object.keys(v.options).forEach((k) => !names.includes(k) && names.push(k)));
  const options = names.map((name) => ({ name, values: Array.from(new Set(p.variants.map((v) => v.options[name]).filter(Boolean))) }));
  return {
    id: p.id, title: p.title, description: p.description, status: p.status, vendor: p.vendor ?? "", productType: p.productType ?? "",
    tagsText: p.tags.join(", "), notes: p.notes, marketIds: p.marketIds, regions: p.regions ?? {}, images: p.images ?? [],
    trackInventory: p.trackInventory ?? true, continueSelling: p.continueSelling ?? false, physical: p.physical ?? true, chargeTax: p.chargeTax ?? true, isGiftCard: p.isGiftCard ?? false,
    seoTitle: p.seoTitle ?? "", seoDescription: p.seoDescription ?? "", handle: p.handle, handleTouched: true,
    options,
    variants: p.variants.map((v) => ({
      id: v.id, options: v.options, title: v.title, sku: v.sku ?? "", barcode: v.barcode ?? "", inventory: String(v.inventory), weight: gramsToUnit(v.weightG, "kg"),
      prices: Object.fromEntries(Object.entries(v.prices).map(([m, x]) => [m, { amount: toMajor(x.amount), compareAt: toMajor(x.compareAt ?? undefined) }])),
    })),
  };
}

// Every combination of option values, in order. No (valid) options = a single "Default" variant.
function combos(opts: OptionDef[]): Record<string, string>[] {
  return opts.filter((o) => o.name.trim() && o.values.length).reduce<Record<string, string>[]>((acc, o) => acc.flatMap((a) => o.values.map((v) => ({ ...a, [o.name.trim()]: v }))), [{}]);
}

// Rebuild the variant list for new options without losing what was typed:
//  1. a combination that already exists keeps its data,
//  2. a combination that refines an old variant (e.g. "Size: S" -> "Size: S, Color: Red") inherits from it: the first child
//     takes over the old variant completely (id, SKU, stock), the others copy its prices only (SKUs must stay unique),
//  3. a combination made coarser (an option was removed) takes over the first old variant that contained it.
function syncVariants(current: VForm[], opts: OptionDef[]): VForm[] {
  const claimed = new Set<VForm>();
  const subset = (a: Record<string, string>, b: Record<string, string>) => Object.entries(a).every(([k, v]) => b[k] === v); // a ⊆ b
  const bySig = new Map(current.map((v) => [sigOf(v.options), v]));
  return combos(opts).map((c) => {
    const title = Object.values(c).join(" / ") || "Default";
    const exact = bySig.get(sigOf(c));
    if (exact && !claimed.has(exact)) { claimed.add(exact); return { ...exact, options: c, title }; }
    // closest existing parent: most specific old variant whose options are all contained in this combination
    const parent = current.filter((v) => subset(v.options, c)).sort((x, y) => Object.keys(y.options).length - Object.keys(x.options).length)[0];
    if (parent && !claimed.has(parent)) { claimed.add(parent); return { ...parent, options: c, title }; }
    if (parent) return { ...blankVariant(), prices: structuredClone(parent.prices), options: c, title };
    const child = current.find((v) => !claimed.has(v) && subset(c, v.options));
    if (child) { claimed.add(child); return { ...child, options: c, title }; }
    return { ...blankVariant(), options: c, title };
  });
}

function ChipsInput({ values, onChange, placeholder, invalid, onTouch }: { values: string[]; onChange: (v: string[]) => void; placeholder: string; invalid?: boolean; onTouch?: () => void }) {
  const [text, setText] = useState("");
  const add = () => {
    const parts = text.split(",").map((t) => t.trim()).filter(Boolean);
    if (parts.length) onChange(Array.from(new Set([...values, ...parts])));
    setText("");
  };
  return (
    <div className="chipsinput" aria-invalid={invalid || undefined}>
      {values.map((v) => <span key={v} className="chip">{v}<button type="button" className="link" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))}>✕</button></span>)}
      <input value={text} placeholder={values.length ? "" : placeholder} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); } else if (e.key === "Backspace" && !text && values.length) onChange(values.slice(0, -1)); }} onBlur={() => { add(); onTouch?.(); }} />
    </div>
  );
}

export function ProductEditor({ markets, initial, onDone }: { markets: Market[]; initial: Form; onDone: () => void }) {
  const [f, setF] = useState(initial);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<Pending[]>([]);
  const [unit, setUnit] = useState<Unit>("kg");
  const [codesFor, setCodesFor] = useState<number | null>(null);
  const selected = markets.filter((m) => f.marketIds.includes(m.id));
  const hasOptions = f.options.length > 0;
  const single = f.variants[0];
  const handle = f.handleTouched ? f.handle : slug(f.title);
  const [srv, setSrv] = useState<Record<string, string>>({}); // errors only the server can know (duplicate handle / SKU)

  // every rule lives here, computed from the current form; <useValidation> decides when each one is shown
  const E: Record<string, string> = {};
  {
    E.title = !f.title.trim() ? "Add a title" : f.title.length > 255 ? "The title is too long (max 255 characters)" : "";
    E.markets = f.marketIds.length ? "" : "Select at least one market to sell this product in";
    const names = f.options.map((o) => o.name.trim().toLowerCase());
    f.options.forEach((o, i) => {
      E[`optname:${i}`] = !o.name.trim() ? "Name this option, for example Size" : names.indexOf(o.name.trim().toLowerCase()) !== i ? "Option names must be different" : "";
      E[`optvalues:${i}`] = o.values.length ? "" : "Add at least one value, then press Enter";
    });
    const skuCount = new Map<string, number>();
    f.variants.forEach((x) => { const k = x.sku.trim().toLowerCase(); if (k) skuCount.set(k, (skuCount.get(k) ?? 0) + 1); });
    const bcCount = new Map<string, number>();
    f.variants.forEach((x) => { const k = x.barcode.trim(); if (k) bcCount.set(k, (bcCount.get(k) ?? 0) + 1); });
    f.variants.forEach((x, i) => {
      selected.forEach((m) => {
        const a = x.prices[m.id]?.amount ?? "", c = x.prices[m.id]?.compareAt ?? "";
        E[`price:${i}:${m.id}`] = money(a, { label: `${m.currency} price` });
        E[`compare:${i}:${m.id}`] = money(c, { required: false, label: "compare-at price" }) || (c.trim() && !E[`price:${i}:${m.id}`] && Number(c) <= Number(a) ? "The compare-at price must be higher than the price" : "");
      });
      E[`qty:${i}`] = f.trackInventory ? int(x.inventory, 0, 1_000_000, "quantity") : "";
      const sku = x.sku.trim();
      E[`sku:${i}`] = sku.length > 64 ? "The SKU is too long (max 64 characters)" : sku && (skuCount.get(sku.toLowerCase()) ?? 0) > 1 ? "Another variant already uses this SKU" : srv[`sku:${sku}`] ? srv[`sku:${sku}`] : "";
      E[`barcode:${i}`] = barcodeError(x.barcode) || (x.barcode.trim() && (bcCount.get(x.barcode.trim()) ?? 0) > 1 ? "Another variant already uses this barcode" : "");
      E[`weight:${i}`] = f.physical ? decimal(x.weight, 100_000, "weight") : "";
    });
    E.handle = !handle ? "Enter a URL handle" : srv.handle ?? "";
  }
  const val = useValidation(E);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((cur) => ({ ...cur, [k]: v }));
  // Generate: a SKU from the product name + options, or an EAN-13 with a valid check digit. Both are checked against the
  // other variants here and against every other product on the server, so the result is never a duplicate.
  const generate = async (kind: "sku" | "barcode", only?: number[]) => {
    setErr("");
    try {
      const idx = only ?? f.variants.map((_, i) => i).filter((i) => !f.variants[i][kind].trim());
      const skuTaken = new Set(f.variants.map((v) => v.sku.trim().toLowerCase()).filter(Boolean));
      const bcTaken = new Set(f.variants.map((v) => v.barcode.trim()).filter(Boolean));
      const out: Record<number, string> = {};
      for (const i of idx) {
        for (let tries = 0; tries < 6; tries++) {
          const cand = kind === "sku" ? makeSku(f.title || "Item", f.variants[i].options, skuTaken) : makeEan13();
          const t = await api<{ skus: (string | null)[]; barcodes: (string | null)[] }>("/products/codes/taken", { method: "POST", json: { skus: kind === "sku" ? [cand] : [], barcodes: kind === "barcode" ? [cand] : [], productId: f.id } });
          const used = (kind === "sku" ? t.skus : t.barcodes).some((x) => x?.toLowerCase() === cand.toLowerCase());
          if (used || (kind === "barcode" && bcTaken.has(cand))) { if (kind === "sku") skuTaken.add(cand.toLowerCase()); continue; }
          out[i] = cand; (kind === "sku" ? skuTaken : bcTaken).add(kind === "sku" ? cand.toLowerCase() : cand); break;
        }
      }
      setF((cur) => ({ ...cur, variants: cur.variants.map((v, j) => (out[j] ? { ...v, [kind]: out[j] } : v)) }));
      setSrv((cur) => Object.fromEntries(Object.entries(cur).filter(([k]) => !k.startsWith("sku:"))));
    } catch (e) { setErr((e as Error).message); }
  };
  const setVariant = (i: number, patch: Partial<VForm>) => setF((cur) => ({ ...cur, variants: cur.variants.map((v, j) => (j === i ? { ...v, ...patch } : v)) }));
  const setPrice = (i: number, mid: string, key: keyof PriceForm, val: string) =>
    setF((cur) => ({
      ...cur,
      variants: cur.variants.map((v, j) => {
        if (j !== i) return v;
        const prev: PriceForm = v.prices[mid] ?? { amount: "", compareAt: "" };
        return { ...v, prices: { ...v.prices, [mid]: { ...prev, [key]: val } } };
      }),
    }));
  const setOptions = (options: OptionDef[]) => setF((cur) => ({ ...cur, options, variants: syncVariants(cur.variants, options) }));
  const toggleMarket = (id: string) => set("marketIds", f.marketIds.includes(id) ? f.marketIds.filter((x) => x !== id) : [...f.marketIds, id]);

  // switching unit converts what's typed so the weight stays the same
  const changeUnit = (u: Unit) => {
    setF((cur) => ({ ...cur, variants: cur.variants.map((v) => ({ ...v, weight: v.weight ? gramsToUnit(Math.round(parseFloat(v.weight) * UNIT_G[unit]), u) : "" })) }));
    setUnit(u);
  };

  const save = async () => {
    if (f.variants.length > 100) return setErr("A product can have at most 100 variants.");
    if (!val.submit()) return setErr("Some fields need attention. They are highlighted below.");
    setErr(""); setSrv({}); setSaving(true);
    const body = {
      title: f.title.trim(), description: f.description, status: f.status, vendor: f.vendor, productType: f.productType, notes: f.notes,
      marketIds: f.marketIds, regions: Object.fromEntries(f.marketIds.map((m) => [m, f.regions[m] ?? []])),
      tags: f.tagsText.split(",").map((t) => t.trim()).filter(Boolean),
      trackInventory: f.trackInventory, continueSelling: f.continueSelling, physical: f.physical, chargeTax: f.chargeTax, isGiftCard: f.isGiftCard,
      seoTitle: f.seoTitle, seoDescription: f.seoDescription, ...(handle ? { handle } : {}),
      variants: f.variants.map((v) => ({
        id: v.id, title: v.title || "Default", options: v.options, sku: v.sku.trim() || null, barcode: v.barcode.trim() || null,
        inventory: Math.max(0, parseInt(v.inventory || "0") || 0), weightG: f.physical && v.weight ? Math.round(parseFloat(v.weight) * UNIT_G[unit]) : 0,
        prices: Object.fromEntries(f.marketIds.map((mid) => [mid, { amount: toMinor(v.prices[mid]?.amount ?? ""), compareAt: v.prices[mid]?.compareAt ? toMinor(v.prices[mid].compareAt) : null }])),
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
        // product is saved; stay on the page (now in edit mode) so the failed files can be retried
        const fresh = await api<Product>(`/products/${saved.id}`);
        setF((cur) => ({ ...cur, id: saved.id, images: fresh.images, handle: fresh.handle, handleTouched: true }));
        setPending(failed);
        setErr(`Product saved, but ${failed.length} image(s) failed: ${errors.join("; ")}`);
        setSaving(false);
        return;
      }
      onDone();
    } catch (e) {
      const msg = (e as Error).message;
      // show server-side conflicts next to the field they belong to
      if (/URL handle/i.test(msg)) { setSrv({ handle: msg }); val.touch("handle"); setErr("Some fields need attention. They are highlighted below."); }
      else if (/sku/i.test(msg)) { const dup = f.variants.map((x) => x.sku.trim()).find(Boolean) ?? ""; setSrv(f.variants.reduce((o, x) => (x.sku.trim() ? { ...o, [`sku:${x.sku.trim()}`]: msg } : o), {})); f.variants.forEach((_, i) => val.touch(`sku:${i}`)); setErr(msg || dup); }
      else setErr(msg);
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!f.id || !confirm("Delete this product? If it has been ordered it is archived instead.")) return;
    try { await api(`/products/${f.id}`, { method: "DELETE" }); onDone(); } catch (e) { setErr((e as Error).message); }
  };

  return (
    <>
      <div className="crumbbar"><button className="link crumb" onClick={onDone}><ArrowLeft />Products</button></div>
      <div className="pagehead">
        <h2>{f.id ? "Edit product" : "Add product"}</h2>
        <div className="headtools">
          <button onClick={onDone}>Discard</button>
          <button className="primary" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save"}</button>
        </div>
      </div>
      {err && <div className="error">{err}</div>}

      <div className="cols">
        <div>
          <div className="card">
            <div className="field"><label htmlFor="pe-title">Title</label><input id="pe-title" value={f.title} placeholder="Short sleeve t-shirt" onChange={(e) => set("title", e.target.value)} {...val.props("title")} /><FieldError k="title" msg={val.err("title")} /></div>
            <div className="field" style={{ marginBottom: 0 }}><label>Description</label><RichTextEditor value={f.description} resetKey={f.id ?? "new"} onChange={(h) => set("description", h)} /></div>
          </div>

          <ImageManager productId={f.id} images={f.images} onImages={(images) => setF((cur) => ({ ...cur, images }))} pending={pending} onPending={setPending} />

          {!hasOptions && (
            <>
              <div className="card">
                <h3>Pricing</h3>
                {!selected.length ? (
                  <p className="muted">Choose the markets you sell in (right side) to set a price for each.</p>
                ) : (
                  <div className="row">
                    {selected.map((m) => (
                      <div key={m.id} className="field">
                        <label>{m.code} price ({m.currency})</label>
                        <input type="number" step="0.01" min={0} placeholder="0.00" value={single.prices[m.id]?.amount ?? ""} onChange={(e) => setPrice(0, m.id, "amount", e.target.value)} {...val.props(`price:0:${m.id}`)} />
                        <FieldError k={`price:0:${m.id}`} msg={val.err(`price:0:${m.id}`)} />
                        <input type="number" step="0.01" min={0} placeholder="Compare-at price (optional)" style={{ marginTop: 6 }} value={single.prices[m.id]?.compareAt ?? ""} onChange={(e) => setPrice(0, m.id, "compareAt", e.target.value)} {...val.props(`compare:0:${m.id}`)} />
                        <FieldError k={`compare:0:${m.id}`} msg={val.err(`compare:0:${m.id}`)} />
                      </div>
                    ))}
                  </div>
                )}
                <div className="toggleline"><Switch checked={f.chargeTax} onChange={(v) => set("chargeTax", v)} label="Charge tax on this product" /><span>Charge tax on this product</span></div>
              </div>
              <div className="card">
                <div className="cardhead"><h3>Inventory</h3><span className="toggleline"><span className="muted">Inventory tracked</span><Switch checked={f.trackInventory} onChange={(v) => set("trackInventory", v)} label="Inventory tracked" /></span></div>
                {f.trackInventory && (
                  <div className="field" style={{ maxWidth: 220 }}><label>Quantity</label><input type="number" min={0} value={single.inventory} onChange={(e) => setVariant(0, { inventory: e.target.value })} {...val.props("qty:0")} /><FieldError k="qty:0" msg={val.err("qty:0")} /></div>
                )}
                <div className="row">
                  <div className="field"><div className="genrow"><label htmlFor="sku-0">SKU (stock keeping unit)</label><span className="acts"><button className="link" type="button" onClick={() => generate("sku", [0])}>Generate</button></span></div><input id="sku-0" value={single.sku} onChange={(e) => setVariant(0, { sku: e.target.value })} {...val.props("sku:0")} /><FieldError k="sku:0" msg={val.err("sku:0")} /></div>
                  <div className="field"><div className="genrow"><label htmlFor="bc-0">Barcode (ISBN, UPC, GTIN…)</label><span className="acts"><button className="link" type="button" onClick={() => generate("barcode", [0])}>Generate</button><button className="link" type="button" disabled={!single.sku.trim() && !single.barcode.trim()} onClick={() => setCodesFor(0)}>Preview</button></span></div><input id="bc-0" value={single.barcode} onChange={(e) => setVariant(0, { barcode: e.target.value })} {...val.props("barcode:0")} /><FieldError k="barcode:0" msg={val.err("barcode:0")} /></div>
                </div>
                {f.trackInventory && <label className="check"><input type="checkbox" checked={f.continueSelling} onChange={(e) => set("continueSelling", e.target.checked)} />Continue selling when out of stock</label>}
              </div>
            </>
          )}

          <div className="card">
            <div className="cardhead"><h3>Gift card</h3><span className="toggleline"><span className="muted">This product is a gift card</span><Switch checked={f.isGiftCard} onChange={(v) => setF((c) => ({ ...c, isGiftCard: v, ...(v ? { physical: false, chargeTax: false, trackInventory: false } : {}) }))} label="This product is a gift card" /></span></div>
            <p className="muted" style={{ margin: 0 }}>{f.isGiftCard ? "Each variant is a gift card amount (for example £25, £50). When an order is paid, the buyer is emailed a code worth that amount. Nothing is shipped or taxed when it is sold." : "Turn this on to sell gift cards. Each variant becomes an amount customers can buy."}</p>
          </div>

          <div className="card">
            <div className="cardhead"><h3>Shipping</h3><span className="toggleline"><span className="muted">Physical product</span><Switch checked={f.physical} onChange={(v) => set("physical", v)} label="Physical product" /></span></div>
            {f.physical ? (
              !hasOptions ? (
                <div className="row" style={{ maxWidth: 360 }}>
                  <div className="field"><label>Weight</label><input type="number" min={0} step="0.001" placeholder="0.0" value={single.weight} onChange={(e) => setVariant(0, { weight: e.target.value })} {...val.props("weight:0")} /><FieldError k="weight:0" msg={val.err("weight:0")} /></div>
                  <div className="field" style={{ flex: "0 0 100px", minWidth: 100 }}><label>Unit</label><Select value={unit} onChange={(e) => changeUnit(e.target.value as Unit)}>{(Object.keys(UNIT_G) as Unit[]).map((u) => <option key={u}>{u}</option>)}</Select></div>
                </div>
              ) : <p className="muted">Set the weight for each variant in the table below.</p>
            ) : <p className="muted">This product isn’t shipped (for example a digital download or a service), so customers aren’t charged shipping for it.</p>}
          </div>

          <div className="card">
            <h3>Variants</h3>
            {!hasOptions ? (
              <button onClick={() => setOptions([{ name: "Size", values: [] }])}><Plus />Add options like size or color</button>
            ) : (
              <>
                {f.options.map((o, i) => (
                  <div key={i} className="optionrow">
                    <div className="field"><label>Option name</label><input value={o.name} placeholder="Size" onChange={(e) => setOptions(f.options.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} {...val.props(`optname:${i}`)} /><FieldError k={`optname:${i}`} msg={val.err(`optname:${i}`)} /></div>
                    <div className="field grow"><label>Option values</label><ChipsInput values={o.values} placeholder="Type a value and press Enter" invalid={!!val.err(`optvalues:${i}`)} onTouch={() => val.touch(`optvalues:${i}`)} onChange={(values) => setOptions(f.options.map((x, j) => (j === i ? { ...x, values } : x)))} /><FieldError k={`optvalues:${i}`} msg={val.err(`optvalues:${i}`)} /></div>
                    <button className="link" aria-label={`Remove option ${o.name}`} onClick={() => setOptions(f.options.filter((_, j) => j !== i))}>Remove</button>
                  </div>
                ))}
                {f.options.length < 3 && <button onClick={() => setOptions([...f.options, { name: "", values: [] }])}><Plus />Add another option</button>}

                <div className="vhead">
                  <b>{f.variants.length} variant{f.variants.length === 1 ? "" : "s"}</b>
                  <span className="acts"><button className="link" type="button" onClick={() => generate("sku")}>Generate missing SKUs</button><button className="link" type="button" onClick={() => generate("barcode")}>Generate missing barcodes</button></span>
                </div>
                <div className="vlist">
                  {f.variants.map((v, i) => (
                    <div key={v.title + i} className="vcard">
                      <div className="vcard-h">
                        <b>{v.title}</b>
                        <button className="link" type="button" disabled={!v.sku.trim() && !v.barcode.trim()} onClick={() => setCodesFor(i)}>Preview barcode and QR</button>
                      </div>
                      <div className="vgrid">
                        {selected.map((m) => (
                          <div key={m.id} className="field"><label htmlFor={`pr-${i}-${m.id}`}>{m.code} price ({m.currency})</label>
                            <input id={`pr-${i}-${m.id}`} type="number" step="0.01" min={0} placeholder="0.00" value={v.prices[m.id]?.amount ?? ""} onChange={(e) => setPrice(i, m.id, "amount", e.target.value)} {...val.props(`price:${i}:${m.id}`)} />
                            <FieldError small k={`price:${i}:${m.id}`} msg={val.err(`price:${i}:${m.id}`)} />
                          </div>
                        ))}
                        {selected.map((m) => (
                          <div key={`c${m.id}`} className="field"><label htmlFor={`cp-${i}-${m.id}`} title="The original price, shown crossed out next to the real price. Must be higher than the price.">{m.code} compare-at (was price)</label>
                            <input id={`cp-${i}-${m.id}`} type="number" step="0.01" min={0} placeholder="Crossed-out price, optional" value={v.prices[m.id]?.compareAt ?? ""} onChange={(e) => setPrice(i, m.id, "compareAt", e.target.value)} {...val.props(`compare:${i}:${m.id}`)} />
                            <FieldError small k={`compare:${i}:${m.id}`} msg={val.err(`compare:${i}:${m.id}`)} />
                          </div>
                        ))}
                        {f.trackInventory && (
                          <div className="field"><label htmlFor={`qt-${i}`}>Quantity</label>
                            <input id={`qt-${i}`} type="number" min={0} value={v.inventory} onChange={(e) => setVariant(i, { inventory: e.target.value })} {...val.props(`qty:${i}`)} />
                            <FieldError small k={`qty:${i}`} msg={val.err(`qty:${i}`)} />
                          </div>
                        )}
                        {f.physical && (
                          <div className="field"><label htmlFor={`wt-${i}`}>Weight ({unit})</label>
                            <input id={`wt-${i}`} type="number" min={0} step="0.001" value={v.weight} onChange={(e) => setVariant(i, { weight: e.target.value })} {...val.props(`weight:${i}`)} />
                            <FieldError small k={`weight:${i}`} msg={val.err(`weight:${i}`)} />
                          </div>
                        )}
                      </div>
                      <div className="vcodes">
                        <div className="field"><div className="genrow"><label htmlFor={`sk-${i}`}>SKU</label><span className="acts"><button className="link" type="button" onClick={() => generate("sku", [i])}>Generate</button></span></div>
                          <input id={`sk-${i}`} value={v.sku} onChange={(e) => setVariant(i, { sku: e.target.value })} {...val.props(`sku:${i}`)} />
                          <FieldError small k={`sku:${i}`} msg={val.err(`sku:${i}`)} />
                        </div>
                        <div className="field"><div className="genrow"><label htmlFor={`bc-${i}`}>Barcode</label><span className="acts"><button className="link" type="button" onClick={() => generate("barcode", [i])}>Generate</button></span></div>
                          <input id={`bc-${i}`} value={v.barcode} onChange={(e) => setVariant(i, { barcode: e.target.value })} {...val.props(`barcode:${i}`)} />
                          <FieldError small k={`barcode:${i}`} msg={val.err(`barcode:${i}`)} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="toggleline" style={{ marginTop: 16 }}><Switch checked={f.trackInventory} onChange={(v) => set("trackInventory", v)} label="Inventory tracked" /><span>Inventory tracked</span></div>
                {f.trackInventory && <label className="check"><input type="checkbox" checked={f.continueSelling} onChange={(e) => set("continueSelling", e.target.checked)} />Continue selling when out of stock</label>}
                <div className="toggleline" style={{ marginTop: 8 }}><Switch checked={f.chargeTax} onChange={(v) => set("chargeTax", v)} label="Charge tax on this product" /><span>Charge tax on this product</span></div>
              </>
            )}
          </div>

          <div className="card">
            <h3>Search engine listing</h3>
            <div className="seopreview">
              <div className="seotitle">{f.seoTitle || f.title || "Product title"}</div>
              <div className="seourl">{typeof location !== "undefined" ? location.host : ""} › products › {handle || "product-handle"}</div>
              <div className="seodesc">{f.seoDescription || "Add a description so search engines and shoppers know what this product is."}</div>
            </div>
            <div className="field"><label>Page title <span className="muted">({f.seoTitle.length}/70)</span></label><input maxLength={70} value={f.seoTitle} onChange={(e) => set("seoTitle", e.target.value)} /></div>
            <div className="field"><label>Meta description <span className="muted">({f.seoDescription.length}/320)</span></label><textarea rows={3} maxLength={320} value={f.seoDescription} onChange={(e) => set("seoDescription", e.target.value)} /></div>
            <div className="field" style={{ marginBottom: 0 }}><label>URL handle</label><div className="prefixed" aria-invalid={val.err("handle") ? true : undefined}><span>/products/</span><input value={handle} onChange={(e) => { setSrv((x) => ({ ...x, handle: "" })); setF((cur) => ({ ...cur, handle: slug(e.target.value), handleTouched: true })); }} onBlur={() => val.touch("handle")} /></div><FieldError k="handle" msg={val.err("handle")} /></div>
          </div>

          <div className="savebar">
            {f.id && <button className="danger" onClick={remove}>Delete product</button>}
            <span style={{ flex: 1 }} />
            <button onClick={onDone}>Discard</button>
            <button className="primary" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save"}</button>
          </div>
        </div>

        <aside className="sideform">
          <div className="card">
            <h3>Status</h3>
            <Select value={f.status} onChange={(e) => set("status", e.target.value as Product["status"])}>
              <option value="active">Active</option><option value="draft">Draft</option><option value="archived">Archived</option>
            </Select>
            <p className="muted">{f.status === "active" ? "Visible on the storefront in the markets below." : f.status === "draft" ? "Hidden from customers." : "Hidden and kept for your records."}</p>
          </div>

          <div className="card">
            <h3>Markets</h3>
            <div className="checks vertical" role="group" aria-label="Markets" aria-invalid={val.err("markets") ? true : undefined}>
              {markets.filter((m) => m.active).map((m) => (
                <label key={m.id}><input type="checkbox" checked={f.marketIds.includes(m.id)} onChange={() => { toggleMarket(m.id); val.touch("markets"); }} />{m.name} <span className="muted">{m.currency}</span></label>
              ))}
            </div>
            <FieldError k="markets" msg={val.err("markets")} />
            {selected.filter((m) => m.regions.length).map((m) => {
              const all = m.regions.map((r) => r.code);
              const sel = f.regions[m.id]?.length ? f.regions[m.id] : all;
              const toggle = (code: string) => {
                const next = sel.includes(code) ? sel.filter((c) => c !== code) : [...sel, code];
                if (!next.length) return; // must sell somewhere
                set("regions", { ...f.regions, [m.id]: next.length === all.length ? [] : next });
              };
              return (
                <div key={m.id} className="regions">
                  <h4>{m.name}: which {m.code === "US" ? "states" : "provinces"}?</h4>
                  <div className="checks vertical">
                    {m.regions.map((r) => <label key={r.code}><input type="checkbox" checked={sel.includes(r.code)} onChange={() => toggle(r.code)} />{r.name} <span className="muted">{r.taxRateBps / 100}%</span></label>)}
                  </div>
                  <button className="link" onClick={() => set("regions", { ...f.regions, [m.id]: [] })}>Select all</button>
                  <span className="muted"> · {sel.length === all.length ? `Sold everywhere in ${m.name}` : `${sel.length} of ${all.length} selected`}</span>
                </div>
              );
            })}
            {!!selected.length && <p className="muted" style={{ marginTop: 12 }}>{selected.map((m) => `${m.code}: ${m.taxInclusive ? "tax included in price" : `tax ${m.taxRateBps / 100}% added at checkout`}`).join(" · ")}</p>}
          </div>

          <div className="card">
            <h3>Product organization</h3>
            <div className="field"><label>Product type</label><input value={f.productType} placeholder="e.g. Idol" onChange={(e) => set("productType", e.target.value)} /></div>
            <div className="field"><label>Vendor</label><input value={f.vendor} placeholder="e.g. Utsav Vibes" onChange={(e) => set("vendor", e.target.value)} /></div>
            <div className="field" style={{ marginBottom: 0 }}><label>Tags</label><ChipsInput values={f.tagsText.split(",").map((t) => t.trim()).filter(Boolean)} placeholder="Add tags" onChange={(v) => set("tagsText", v.join(", "))} /></div>
          </div>

          <div className="card">
            <h3>Internal notes</h3>
            <textarea rows={3} value={f.notes} placeholder="Only you and your team see this" onChange={(e) => set("notes", e.target.value)} />
          </div>
        </aside>
      </div>
      {codesFor !== null && f.variants[codesFor] && <CodePreview title={`${f.title || "New product"}${f.variants[codesFor].title !== "Default" ? ` — ${f.variants[codesFor].title}` : ""}`} sku={f.variants[codesFor].sku} barcode={f.variants[codesFor].barcode} onClose={() => setCodesFor(null)} />}
    </>
  );
}
