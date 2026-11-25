"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, toMajor, toMinor, uploadImage, type Market, type Product, type ProductImage, type StockMarket } from "@/lib/api";
import { decimal, int, money } from "@/lib/validators";
import { barcodeError, makeEan13, makeSku } from "@/lib/codes";
import { CodePreview } from "./CodePreview";
import { FieldError, useValidation } from "./validation";
import { ArrowLeft, Plus } from "../Icons";
import { ImageManager, type Pending } from "./ImageManager";
import { RichTextEditor } from "./RichTextEditor";
import { Switch } from "./Switch";
import { useApi } from "./hooks";
import { Select } from "../Select";
import { Modal } from "./Modal";
import { toast } from "@/lib/toast";
import { PickList } from "./PickList";

const PAL = ["#f97203", "#2f80ed", "#27ae60", "#9b51e0", "#eb5757", "#f2c94c", "#00b8d9", "#ff6b9a"];

export type OptionDef = { name: string; values: string[] };
type PriceForm = { amount: string };
export type LocStock = { qty: string; sku: string; barcode: string }; // stock of one variant at one location, with that location's own SKU and barcode
export type VForm = { id?: string; imageId?: string | null; qrActive?: boolean; options: Record<string, string>; title: string; sku: string; barcode: string; inventory: string; stock: Record<string, LocStock>; locQty: Record<string, string>; weight: string; prices: Record<string, PriceForm> };
export type Form = {
  id?: string; title: string; description: string; status: Product["status"]; vendor: string; productType: string; tagsText: string; notes: string;
  collectionIds: string[]; marketIds: string[]; regions: Record<string, string[]>; images: ProductImage[];
  trackInventory: boolean; continueSelling: boolean; physical: boolean; chargeTax: boolean; isGiftCard: boolean;
  seoTitle: string; seoDescription: string; handle: string; handleTouched: boolean;
  options: OptionDef[]; variants: VForm[];
};

const UNIT_G = { kg: 1000, g: 1, lb: 453.592, oz: 28.3495 } as const;
type Unit = keyof typeof UNIT_G;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100);
const sigOf = (o: Record<string, string>) => JSON.stringify(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
const blankVariant = (): VForm => ({ options: {}, title: "Default", sku: "", barcode: "", inventory: "", stock: {}, locQty: {}, weight: "", prices: {} });

export const blank = (): Form => ({
  title: "", description: "", status: "draft", vendor: "", productType: "", tagsText: "", notes: "", collectionIds: [], marketIds: [], regions: {}, images: [],
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
    tagsText: p.tags.join(", "), notes: p.notes, collectionIds: p.collectionIds ?? [], marketIds: p.marketIds, regions: p.regions ?? {}, images: p.images ?? [],
    trackInventory: p.trackInventory ?? true, continueSelling: p.continueSelling ?? false, physical: p.physical ?? true, chargeTax: p.chargeTax ?? true, isGiftCard: p.isGiftCard ?? false,
    seoTitle: p.seoTitle ?? "", seoDescription: p.seoDescription ?? "", handle: p.handle, handleTouched: true,
    options,
    variants: p.variants.map((v) => ({
      id: v.id, imageId: (v as { imageId?: string | null }).imageId ?? null, qrActive: v.qrActive !== false, options: v.options, title: v.title, sku: v.sku ?? "", barcode: v.barcode ?? "", inventory: String(v.inventory), stock: Object.fromEntries(Object.entries(v.stock ?? {}).map(([k, l]) => [k, { qty: String(l.quantity), sku: l.sku ?? "", barcode: l.barcode ?? "" }])), locQty: Object.fromEntries(Object.entries(v.locationStock ?? {}).map(([k, q]) => [k, String(q)])), weight: gramsToUnit(v.weightG, "kg"),
      prices: Object.fromEntries(Object.entries(v.prices).map(([m, x]) => [m, { amount: toMajor(x.amount) }])),
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
    return { ...blankVariant(), prices: structuredClone(current[0]?.prices ?? {}), options: c, title }; // a new value starts at the shared price
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
  // Unsaved-changes guard: closing the tab, refreshing, clicking a link or Discard asks first.
  const startJson = useRef(JSON.stringify(initial));
  const leaving = useRef(false); // set once we saved/deleted/chose to leave
  const dirty = !leaving.current && (JSON.stringify(f) !== startJson.current || pending.length > 0);
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || e.metaKey || e.ctrlKey || a.origin !== location.origin || a.pathname === location.pathname) return;
      e.preventDefault(); e.stopPropagation(); setLeaveTo(a.href);
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", onClick, true);
    return () => { window.removeEventListener("beforeunload", beforeUnload); document.removeEventListener("click", onClick, true); };
  }, [dirty]);
  const [leaveTo, setLeaveTo] = useState<string | null>(null); // a link the user clicked while there were unsaved changes
  const goAfterSave = useRef<string | null>(null);
  const leave = () => { if (dirty && !confirm("You have unsaved changes. Leave without saving?")) return; leaving.current = true; onDone(); };
  const [unit, setUnit] = useState<Unit>("kg");
  const [openV, setOpenV] = useState(0); // the variant shown (tabs above it switch)
  const [codesFor, setCodesFor] = useState<number | null>(null);
  const [locCodes, setLocCodes] = useState<{ i: number; loc: StockMarket } | null>(null); // preview of one market's code
  const selected = markets.filter((m) => f.marketIds.includes(m.id));
  const locs: StockMarket[] = selected; // stock is counted per market the product is sold in
  // Stock locations (Settings → Locations), each tied to a market and a state/province of it. A market without locations has one whole-market count.
  const { data: siteLocs } = useApi<{ id: string; name: string; marketId: string | null; regionCode: string | null }[]>("/products/stock/locations");
  const locsOf = (mid: string) => (siteLocs ?? []).filter((l) => l.marketId === mid);
  const marketQty = (v: VForm, mid: string) => { const ls = locsOf(mid); return ls.length ? ls.reduce((a, l) => a + (parseInt(v.locQty[l.id] || "0") || 0), 0) : parseInt(v.stock[mid]?.qty || "0") || 0; };
  const marketFilled = (v: VForm, mid: string) => { const ls = locsOf(mid); return ls.length ? ls.some((l) => (v.locQty[l.id] ?? "").trim() !== "") : (v.stock[mid]?.qty ?? "").trim() !== ""; };
  const hasOptions = f.options.length > 0;
  const single = f.variants[0];
  const active = Math.min(openV, f.variants.length - 1);
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
    f.variants.forEach((x) => [x.sku, ...Object.values(x.stock).map((l) => l.sku)].forEach((c) => { const k = (c ?? "").trim().toLowerCase(); if (k) skuCount.set(k, (skuCount.get(k) ?? 0) + 1); }));
    const bcCount = new Map<string, number>();
    f.variants.forEach((x) => [x.barcode, ...Object.values(x.stock).map((l) => l.barcode)].forEach((c) => { const k = (c ?? "").trim(); if (k) bcCount.set(k, (bcCount.get(k) ?? 0) + 1); }));
    f.variants.forEach((x, i) => {
      selected.forEach((m) => {
        const a = x.prices[m.id]?.amount ?? "";
        E[`price:${i}:${m.id}`] = money(a, { label: `${m.currency} price` });
      });
      E[`qty:${i}`] = f.trackInventory && !locs.length ? int(x.inventory, 0, 1_000_000, "quantity") : "";
      locs.forEach((l) => {
        const ls = x.stock[l.id];
        const ml = locsOf(l.id);
        E[`qty:${i}:${l.id}`] = !f.trackInventory ? "" : ml.length
          ? (ml.some((q) => (x.locQty[q.id] ?? "").trim() && int(x.locQty[q.id], 0, 1_000_000, "quantity")) ? "Quantities must be whole numbers" : !marketFilled(x, l.id) ? `Enter the stock for ${ml.length === 1 ? ml[0].name : "at least one location"}` : "")
          : int(ls?.qty ?? "", 0, 1_000_000, "quantity");
        const s2 = (ls?.sku ?? "").trim().toLowerCase();
        E[`lsku:${i}:${l.id}`] = (ls?.sku ?? "").trim().length > 64 ? "The SKU is too long (max 64 characters)" : s2 && (skuCount.get(s2) ?? 0) > 1 ? "Another variant or location already uses this SKU" : srv[`sku:${ls?.sku?.trim()}`] ?? "";
        const b2 = (ls?.barcode ?? "").trim();
        E[`lbc:${i}:${l.id}`] = barcodeError(b2) || (b2 && (bcCount.get(b2) ?? 0) > 1 ? "Another variant or location already uses this barcode" : "");
      });
      const sku = x.sku.trim();
      E[`sku:${i}`] = sku.length > 64 ? "The SKU is too long (max 64 characters)" : sku && (skuCount.get(sku.toLowerCase()) ?? 0) > 1 ? "Another variant already uses this SKU" : srv[`sku:${sku}`] ? srv[`sku:${sku}`] : "";
      E[`barcode:${i}`] = barcodeError(x.barcode) || (x.barcode.trim() && (bcCount.get(x.barcode.trim()) ?? 0) > 1 ? "Another variant already uses this barcode" : "");
      E[`weight:${i}`] = f.physical ? decimal(x.weight, 100_000, "weight") : "";
    });
    E.handle = !handle ? "Enter a URL handle" : srv.handle ?? "";
  }
  const val = useValidation(E);

  const patchLoc = (i: number, locId: string, patch: Partial<LocStock>) =>
    setF((cur) => ({ ...cur, variants: cur.variants.map((v, j) => (j === i ? { ...v, stock: { ...v.stock, [locId]: { ...({ qty: "", sku: "", barcode: "" } as LocStock), ...v.stock[locId], ...patch } } } : v)) }));
  // Make this market's SKU (variant SKU + location code, e.g. UV-BOWL-6IN-US) and an EAN-13, unique against everything else.
  const generateLoc = async (i: number, l: StockMarket) => {
    setErr("");
    try {
      const v = f.variants[i];
      const base = v.sku.trim() || makeSku(f.title || "Item", v.options, new Set());
      const taken = new Set(f.variants.flatMap((x) => [x.sku, ...Object.values(x.stock).map((s) => s.sku)]).map((c) => c.trim().toLowerCase()).filter(Boolean));
      const bcTaken = new Set(f.variants.flatMap((x) => [x.barcode, ...Object.values(x.stock).map((s) => s.barcode)]).map((c) => c.trim()).filter(Boolean));
      const cur = v.stock[l.id];
      let sku = cur?.sku.trim() ?? "", barcode = cur?.barcode.trim() ?? "";
      for (let n = 0; !sku && n < 8; n++) {
        const cand = `${base}-${l.code}${n ? `-${n + 1}` : ""}`.slice(0, 64);
        if (taken.has(cand.toLowerCase())) continue;
        const t = await api<{ skus: (string | null)[] }>("/products/codes/taken", { method: "POST", json: { skus: [cand], barcodes: [], productId: f.id } });
        if (!t.skus.some((x) => x?.toLowerCase() === cand.toLowerCase())) sku = cand;
      }
      for (let n = 0; !barcode && n < 6; n++) {
        const cand = makeEan13();
        if (bcTaken.has(cand)) continue;
        const t = await api<{ barcodes: (string | null)[] }>("/products/codes/taken", { method: "POST", json: { skus: [], barcodes: [cand], productId: f.id } });
        if (!t.barcodes.some((x) => x === cand)) barcode = cand;
      }
      patchLoc(i, l.id, { sku, barcode });
    } catch (e) { setErr((e as Error).message); }
  };

  // Quantity per market (with its own SKU, barcode and QR), and the total. Same block for a single product and for each variant.
  // Stock: pick a variant, then set the units at each of a market's locations with simple +/- rows.
  const [planV, setPlanV] = useState(0);
  const stockMatrix = () => {
    const vi = Math.min(planV, f.variants.length - 1);
    const v = f.variants[vi];
    const vTotal = (x: VForm) => locs.reduce((a, m) => a + marketQty(x, m.id), 0);
    return (
      <div className="plan">
        {f.variants.length > 1 && (
          <div className="plan-vars" role="tablist" aria-label="Variant">
            {f.variants.map((x, i) => <button key={i} type="button" role="tab" aria-selected={i === vi} className={i === vi ? "on" : ""} onClick={() => setPlanV(i)}>{x.title}<b>{vTotal(x)}</b></button>)}
          </div>
        )}
        {locs.map((m) => {
          const ml = [...locsOf(m.id)].sort((a, b) => (a.regionCode ?? "~").localeCompare(b.regionCode ?? "~") || a.name.localeCompare(b.name));
          const regionName = (code: string | null) => (code ? markets.find((x) => x.id === m.id)?.regions.find((r) => r.code === code)?.name ?? code : "");
          const qs = ml.map((l) => parseInt(v.locQty[l.id] || "0") || 0);
          const filled = ml.length ? ml.some((l) => (v.locQty[l.id] ?? "").trim() !== "") : (v.stock[m.id]?.qty ?? "").trim() !== "";
          const total = marketQty(v, m.id);
          const err = val.err(`qty:${vi}:${m.id}`);
          return (
            <section key={m.id} className={`plan-m ${err ? "bad" : ""}`} aria-label={`Stock in ${m.name}`}>
              <header><div><b>{m.name}</b><span>{m.code}</span></div><em className="plan-sum"><b>{total}</b> units</em></header>
              {ml.length === 0 ? (
                <div className="plan-row single">
                  <label htmlFor={`pt-${vi}-${m.id}`}>{f.variants.length > 1 ? `${v.title} · whole market` : "Whole market"}</label>
                  <div className="plan-step"><button type="button" aria-label="Remove one" disabled={!(parseInt(v.stock[m.id]?.qty || "0") > 0)} onClick={() => patchLoc(vi, m.id, { qty: String(Math.max(0, (parseInt(v.stock[m.id]?.qty || "0") || 0) - 1)) })}>−</button><input id={`pt-${vi}-${m.id}`} type="number" min={0} inputMode="numeric" placeholder="0" value={v.stock[m.id]?.qty ?? ""} onChange={(e) => patchLoc(vi, m.id, { qty: e.target.value })} onBlur={() => val.touch(`qty:${vi}:${m.id}`)} /><button type="button" aria-label="Add one" onClick={() => patchLoc(vi, m.id, { qty: String((parseInt(v.stock[m.id]?.qty || "0") || 0) + 1) })}>+</button></div>
                </div>
              ) : (
                <ul className="plan-list">
                  {ml.map((l, i) => {
                    const raw = v.locQty[l.id] ?? "";
                    const n = parseInt(raw || "0") || 0;
                    const put = (x: string) => setVariant(vi, { locQty: { ...v.locQty, [l.id]: x } });
                    return (
                      <li key={l.id} className={`plan-row ${raw !== "" && n <= 0 ? "zero" : ""}`} style={{ ["--c" as string]: PAL[i % PAL.length] }}>
                        <span className="iv-dot" />
                        <label htmlFor={`pt-${vi}-${l.id}`} className="nm"><b>{l.name}</b><small>{regionName(l.regionCode) || m.code}</small></label>
                        <div className="plan-step"><button type="button" aria-label={`Remove one at ${l.name}`} disabled={n <= 0} onClick={() => put(String(n - 1))}>−</button><input id={`pt-${vi}-${l.id}`} type="number" min={0} inputMode="numeric" placeholder="0" value={raw} onChange={(e) => put(e.target.value)} onBlur={() => val.touch(`qty:${vi}:${m.id}`)} /><button type="button" aria-label={`Add one at ${l.name}`} onClick={() => put(String(n + 1))}>+</button></div>
                      </li>
                    );
                  })}
                </ul>
              )}
              {ml.length > 1 && <button type="button" className="link plan-zero" onClick={() => setVariant(vi, { locQty: { ...v.locQty, ...Object.fromEntries(ml.filter((l) => (v.locQty[l.id] ?? "").trim() === "").map((l) => [l.id, "0"])) } })}>Fill empty with 0</button>}
              {err && <div className="qtymx-err" role="alert">{err}</div>}
            </section>
          );
        })}
        <p className="muted">Tap + / − or type how many units are at each location. A market's count is the sum of its locations. Locations are set up in Settings → Locations.</p>
      </div>
    );
  };

  // SKU, barcode and QR belong to the market a variant is sold in (all locations of that market share them).
  const codesByMarket = (i: number, v: VForm) => (
    <div className="codesmk">
      {locs.map((m) => {
        const ls = v.stock[m.id];
        return (
          <div key={m.id} className="codesmk-row">
            <div className="codesmk-h"><b>{m.name}</b> <span className="muted">{m.code}</span><span className="acts"><button className="link" type="button" onClick={() => generateLoc(i, m)}>Generate</button><button className="link" type="button" disabled={!ls?.sku.trim() && !ls?.barcode.trim()} onClick={() => setLocCodes({ i, loc: m })}>Preview QR</button></span></div>
            <div className="codesmk-g">
              <div className="field"><label htmlFor={`ls-${i}-${m.id}`}>SKU</label><input id={`ls-${i}-${m.id}`} value={ls?.sku ?? ""} onChange={(e) => patchLoc(i, m.id, { sku: e.target.value })} {...val.props(`lsku:${i}:${m.id}`)} /><FieldError small k={`lsku:${i}:${m.id}`} msg={val.err(`lsku:${i}:${m.id}`)} /></div>
              <div className="field"><label htmlFor={`lb-${i}-${m.id}`}>Barcode</label><input id={`lb-${i}-${m.id}`} value={ls?.barcode ?? ""} onChange={(e) => patchLoc(i, m.id, { barcode: e.target.value })} {...val.props(`lbc:${i}:${m.id}`)} /><FieldError small k={`lbc:${i}:${m.id}`} msg={val.err(`lbc:${i}:${m.id}`)} /></div>
            </div>
          </div>
        );
      })}
    </div>
  );

  const stockFields = () => !locs.length ? (
    <>
      <div className="field" style={{ maxWidth: 220 }}><label>Quantity</label><input type="number" min={0} placeholder="Enter quantity" value={single.inventory} onChange={(e) => setVariant(0, { inventory: e.target.value })} {...val.props("qty:0")} /><FieldError k="qty:0" msg={val.err("qty:0")} /></div>
      <p className="muted" style={{ marginTop: 0 }}>Choose the markets you sell in (right side) to count stock for each location.</p>
    </>
  ) : stockMatrix();
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
  // One price for every variant in a market (red, blue, pink… usually cost the same).
  const setAllPrices = (mid: string, amount: string) =>
    setF((cur) => ({ ...cur, variants: cur.variants.map((v) => ({ ...v, prices: { ...v.prices, [mid]: { ...(v.prices[mid] ?? {}), amount } } })) }));
  const setPrice = (i: number, mid: string, key: keyof PriceForm, val: string) =>
    setF((cur) => ({
      ...cur,
      variants: cur.variants.map((v, j) => {
        if (j !== i) return v;
        const prev: PriceForm = v.prices[mid] ?? { amount: "" };
        return { ...v, prices: { ...v.prices, [mid]: { ...prev, [key]: val } } };
      }),
    }));
  const setOptions = (options: OptionDef[]) => setF((cur) => {
    let variants = syncVariants(cur.variants, options);
    // The count typed on the plain product can't be split between new variants: each one starts empty and gets its own quantity.
    if (cur.variants.every((v) => !Object.keys(v.options).length) && variants.some((v) => Object.keys(v.options).length)) variants = variants.map((v) => ({ ...v, inventory: "", stock: {}, locQty: {} }));
    return { ...cur, options, variants };
  });
  const toggleMarket = (id: string) => set("marketIds", f.marketIds.includes(id) ? f.marketIds.filter((x) => x !== id) : [...f.marketIds, id]);

  // switching unit converts what's typed so the weight stays the same
  const changeUnit = (u: Unit) => {
    setF((cur) => ({ ...cur, variants: cur.variants.map((v) => ({ ...v, weight: v.weight ? gramsToUnit(Math.round(parseFloat(v.weight) * UNIT_G[unit]), u) : "" })) }));
    setUnit(u);
  };

  const save = async () => {
    if (f.variants.length > 100) return setErr("A product can have at most 100 variants.");
    if (!val.submit()) {
      // open the first variant that has a problem so it can be seen
      const bad = f.variants.findIndex((_, i) => Object.keys(E).some((k) => E[k] && new RegExp(`^[a-z]+:${i}(:|$)`).test(k)));
      if (bad >= 0) setOpenV(bad);
      const firstBad = (bad >= 0 ? bad : 0);
      const badLoc = locs.find((l) => Object.keys(E).some((k) => E[k] && new RegExp(`^(qty|lsku|lbc):${firstBad}:${l.id}$`).test(k)));
      // say exactly what is wrong and where, so nothing hides in another variant or location
      const where = (k: string) => {
        const [kind, vi, mid] = k.split(":");
        const v = f.variants[Number(vi)];
        const vname = v && f.variants.length > 1 ? `${v.title}: ` : "";
        const mk = markets.find((m) => m.id === mid)?.code;
        const what = kind === "qty" ? "quantity" : kind === "price" ? "price" : kind === "lsku" || kind === "sku" ? "SKU" : kind === "lbc" || kind === "barcode" ? "barcode" : kind;
        return `${vname}${mk ? `${mk} ` : ""}${what}`;
      };
      const lines = Object.keys(E).filter((k) => E[k]).slice(0, 6).map((k) => (/^[a-z]+:\d+/.test(k) ? `${where(k)} – ${E[k]}` : E[k]));
      return setErr(`Can't save yet. ${lines.join(" · ")}`);
    }
    setErr(""); setSrv({}); setSaving(true);
    const body = {
      title: f.title.trim(), description: f.description, status: f.status, vendor: f.vendor, productType: f.productType, notes: f.notes,
      marketIds: f.marketIds, collectionIds: f.collectionIds, regions: Object.fromEntries(f.marketIds.map((m) => [m, f.regions[m] ?? []])),
      tags: f.tagsText.split(",").map((t) => t.trim()).filter(Boolean),
      trackInventory: f.trackInventory, continueSelling: f.continueSelling, physical: f.physical, chargeTax: f.chargeTax, isGiftCard: f.isGiftCard,
      seoTitle: f.seoTitle, seoDescription: f.seoDescription, ...(handle ? { handle } : {}),
      variants: f.variants.map((v) => ({
        id: v.id, imageId: v.imageId && f.images.some((im) => im.id === v.imageId) ? v.imageId : null, title: v.title || "Default", options: v.options, sku: v.sku.trim() || null, barcode: v.barcode.trim() || null,
        inventory: Math.max(0, parseInt(v.inventory || "0") || 0),
        ...(locs.length ? { stock: Object.fromEntries(locs.map((l) => [l.id, { quantity: marketQty(v, l.id), sku: v.stock[l.id]?.sku.trim() || null, barcode: v.stock[l.id]?.barcode.trim() || null }])) } : {}),
        ...(locs.some((l) => locsOf(l.id).length) ? { locationStock: Object.fromEntries(locs.flatMap((l) => locsOf(l.id)).map((q) => [q.id, Math.max(0, parseInt(v.locQty[q.id] || "0") || 0)])) } : {}),
        weightG: f.physical && v.weight ? Math.round(parseFloat(v.weight) * UNIT_G[unit]) : 0,
        prices: Object.fromEntries(f.marketIds.map((mid) => [mid, { amount: toMinor(v.prices[mid]?.amount ?? ""), compareAt: null }])),
      })),
    };
    try {
      const saved = await api<Product>(f.id ? `/products/${f.id}` : "/products", { method: f.id ? "PUT" : "POST", json: body, toast: f.id ? "Product saved" : "Product created" });
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
        toast.error(`${failed.length} image(s) did not upload. The product itself is saved.`);
        setSaving(false);
        return;
      }
      leaving.current = true;
      if (goAfterSave.current) router.push(goAfterSave.current); else onDone();
    } catch (e) {
      const msg = (e as Error).message;
      // show server-side conflicts next to the field they belong to
      if (/URL handle/i.test(msg)) { setSrv({ handle: msg }); val.touch("handle"); setErr("Some fields need attention. They are highlighted below."); }
      else if (/sku/i.test(msg)) { const dup = f.variants.map((x) => x.sku.trim()).find(Boolean) ?? ""; setSrv(f.variants.reduce((o, x) => (x.sku.trim() ? { ...o, [`sku:${x.sku.trim()}`]: msg } : o), {})); f.variants.forEach((_, i) => val.touch(`sku:${i}`)); setErr(msg || dup); }
      else setErr(msg);
      setSaving(false);
    }
  };

  const { data: meta } = useApi<{ tags: string[]; collections: { id: string; title: string }[] }>("/products/options/meta");
  const beforeGift = useRef<{ physical: boolean; chargeTax: boolean; trackInventory: boolean } | null>(null);
  const router = useRouter();
  const duplicate = async () => {
    if (!f.id || !confirm("Make a copy of this product? The copy is saved as a draft with no stock, SKUs or barcodes.")) return;
    try { const r = await api<{ id: string }>(`/products/${f.id}/duplicate`, { method: "POST", toast: "Product duplicated. You are now editing the copy." }); leaving.current = true; router.push(`/admin/products/${r.id}`); } catch (e) { setErr((e as Error).message); }
  };

  const remove = async () => {
    if (!f.id || !confirm("Delete this product? If it has been ordered it is archived instead.")) return;
    try { await api(`/products/${f.id}`, { method: "DELETE" }); leaving.current = true; onDone(); } catch (e) { setErr((e as Error).message); }
  };

  return (
    <>
      <div className="crumbbar"><button className="link crumb" onClick={leave}><ArrowLeft />Products</button></div>
      <div className="pe-bar">
        <div className="pe-title">
          <h2>{f.id ? (f.title || "Edit product") : "Add product"}</h2>
          {dirty && <span className="pe-unsaved">Unsaved changes</span>}
          <span className={`pe-status ${f.status}`}>{f.status === "active" ? "Active" : f.status === "draft" ? "Draft" : "Archived"}</span>
        </div>
        <div className="headtools">
          {f.id && <button onClick={duplicate}>Duplicate</button>}
          <button onClick={leave}>Discard</button>
          <button className="primary" disabled={saving} onClick={save}>{saving ? "Saving…" : f.id ? "Save changes" : "Save product"}</button>
        </div>
      </div>
      {(() => {
        // live summary of the product as it is being edited: health ring, key numbers and where the stock is
        const vTot = (v: VForm) => locs.reduce((a, m) => a + marketQty(v, m.id), 0);
        const units = f.variants.reduce((a, v) => a + vTot(v), 0);
        const lowN = f.variants.filter((v) => vTot(v) > 0 && vTot(v) <= 5).length;
        const outN = f.variants.filter((v) => vTot(v) <= 0).length;
        const okN = f.variants.length - lowN - outN;
        const CIRC = 2 * Math.PI * 48;
        let off = 0;
        const segs = ([["ok", okN], ["low", lowN], ["out", outN]] as const).filter(([, n]) => n > 0).map(([cls, n]) => { const len = (n / Math.max(1, f.variants.length)) * CIRC; const g = { cls, len: Math.max(0, len - 3), off }; off += len; return g; });
        const places = locs.flatMap((m) => { const ml = locsOf(m.id); return ml.length ? ml.map((l) => ({ id: l.id, name: l.name, sub: m.code, n: f.variants.reduce((a, v) => a + (parseInt(v.locQty[l.id] || "0") || 0), 0) })) : [{ id: `m-${m.id}`, name: "Whole market", sub: m.code, n: f.variants.reduce((a, v) => a + (parseInt(v.stock[m.id]?.qty || "0") || 0), 0) }]; });
        const maxP = Math.max(1, ...places.map((p) => p.n));
        const prices = selected.map((m) => { const xs = f.variants.map((v) => parseFloat(v.prices[m.id]?.amount ?? "")).filter((n) => Number.isFinite(n)); return xs.length ? `${m.code} ${m.currency} ${Math.min(...xs).toFixed(2)}${Math.max(...xs) !== Math.min(...xs) ? "+" : ""}` : ""; }).filter(Boolean);
        const img = f.images[0]?.thumbUrl;
        return (
          <div className="iv"><section className="iv-hero pe-hero" aria-label="Product summary">
            <div className="pe-hero-id">
              <span className="pe-hero-img">{img ? <img src={img} alt="" /> : <span aria-hidden>📦</span>}</span>
              <div><b>{f.title || "New product"}</b><span>{f.variants.length} variant{f.variants.length === 1 ? "" : "s"} · {selected.length} market{selected.length === 1 ? "" : "s"}</span></div>
            </div>
            <div className="iv-ring" role="img" aria-label={`${units} units in stock`}>
              <svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="48" className="iv-ring-bg" />{segs.map((g) => <circle key={g.cls} cx="60" cy="60" r="48" className={`iv-ring-seg ${g.cls}`} strokeDasharray={`${g.len} ${CIRC - g.len}`} strokeDashoffset={-g.off} />)}</svg>
              <div className="iv-ring-mid"><b>{units}</b><span>units</span></div>
            </div>
            <div className="iv-stats">
              <div className="iv-stat ok"><i /><b>{okN}</b><span>Healthy</span></div>
              <div className="iv-stat low"><i /><b>{lowN}</b><span>Running low</span></div>
              <div className="iv-stat out"><i /><b>{outN}</b><span>Sold out</span></div>
            </div>
            <div className="iv-where" aria-label="Where the stock is">
              <div className="iv-where-h">{prices.length ? `Price from · ${prices.join(" · ")}` : "Where the stock is"}</div>
              {!places.length && <div className="muted" style={{ color: "rgba(255,255,255,.7)" }}>Choose a market on the right to see its locations here.</div>}
              {places.map((p, i) => (
                <div key={p.id} className="iv-loc" style={{ ["--c" as string]: PAL[i % PAL.length] }}>
                  <div className="iv-loc-top"><span className="iv-dot" /><b>{p.name}</b><em>{p.n}</em></div>
                  <div className="iv-loc-sub">{p.sub}</div>
                  <div className="iv-bar"><span style={{ width: `${Math.max(p.n ? 4 : 0, Math.round((p.n / maxP) * 100))}%` }} /></div>
                </div>
              ))}
            </div>
          </section></div>
        );
      })()}
      <nav className="pe-nav" aria-label="Jump to a section">
        {[["sec-basics", "Basics"], ["sec-media", "Media"], ["sec-variants", "Variants"], ["sec-pricing", "Pricing"], ["sec-inventory", "Inventory"], ["sec-shipping", "Shipping"], ["sec-seo", "Search listing"]].map(([id, label]) => <a key={id} href={`#${id}`} onClick={(e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>{label}</a>)}
      </nav>
      {err && <div className="error">{err}</div>}

      <div className="cols">
        <div>
          <div className="anchor" id="sec-basics" />
          <div className="card">
            <div className="field"><label htmlFor="pe-title">Title</label><input id="pe-title" value={f.title} placeholder="Short sleeve t-shirt" onChange={(e) => set("title", e.target.value)} {...val.props("title")} /><FieldError k="title" msg={val.err("title")} /></div>
            <div className="field" style={{ marginBottom: 0 }}><label>Description</label><RichTextEditor value={f.description} resetKey={f.id ?? "new"} onChange={(h) => set("description", h)} /></div>
          </div>


          <div className="anchor" id="sec-media" />
          <ImageManager productId={f.id} images={f.images} onImages={(images) => setF((cur) => ({ ...cur, images }))} pending={pending} onPending={setPending} />

          <div className="anchor" id="sec-variants" />
          <div className="card">
            <div className="cardhead"><div><h3>Variants</h3><div className="muted pe-sub">{hasOptions ? "Name each option, then add its values. Variants are made for every combination." : "Does this product come in sizes, colors or other options?"}</div></div></div>
            {!hasOptions ? (
              <button onClick={() => setOptions([{ name: "", values: [] }])}><Plus />Add options like size or color</button>
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
              </>
            )}
          </div>

          <div className="anchor" id="sec-pricing" />
          {hasOptions && (
            <div className="card">
              <h3>Pricing</h3>
              {!selected.length ? (
                <p className="muted">Choose the markets you sell in (right side) to set a price for each.</p>
              ) : (
                <>
                  <div className="row">
                    {selected.map((m) => {
                      const vals = f.variants.map((v) => v.prices[m.id]?.amount ?? "");
                      const same = vals.every((x) => x === vals[0]);
                      return (
                        <div key={m.id} className="field">
                          <label htmlFor={`all-${m.id}`}>{m.code} price ({m.currency})</label>
                          <input id={`all-${m.id}`} type="number" step="0.01" min={0} placeholder={same ? "0.00" : "Mixed prices"} value={same ? vals[0] : ""} onChange={(e) => setAllPrices(m.id, e.target.value)} />
                        </div>
                      );
                    })}
                  </div>
                  <p className="muted" style={{ marginTop: 0 }}>This price is used for all {f.variants.length} variants. To give one variant a different price, open it in the Variants section below.</p>
                </>
              )}
              <div className="toggleline"><Switch checked={f.chargeTax} onChange={(v) => set("chargeTax", v)} label="Charge tax on this product" /><span>Charge tax on this product</span></div>
            </div>
          )}

          <div className="anchor" id="sec-inventory" />
          {hasOptions && (
            <div className="card">
              <div className="cardhead"><div><h3>Inventory</h3><div className="muted pe-sub">Stock: how many of each variant are at each location.</div></div><span className="toggleline"><span className="muted">Track quantity</span><Switch checked={f.trackInventory} onChange={(v) => set("trackInventory", v)} label="Track quantity" /></span></div>
              {f.trackInventory && (locs.length ? stockMatrix() : <p className="muted">Choose the markets you sell in (right side) to count stock for each location.</p>)}
              {f.trackInventory && <label className="check pe-continue"><input type="checkbox" checked={f.continueSelling} onChange={(e) => set("continueSelling", e.target.checked)} /><span><b>Continue selling when out of stock</b><span className="muted" style={{ display: "block" }}>Customers can still order after the count reaches zero.</span></span></label>}
            </div>
          )}

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
                      </div>
                    ))}
                  </div>
                )}
                <div className="toggleline"><Switch checked={f.chargeTax} onChange={(v) => set("chargeTax", v)} label="Charge tax on this product" /><span>Charge tax on this product</span></div>
              </div>
              <div className="anchor" id="sec-inventory" />
              <div className="card">
                <div className="cardhead"><div><h3>Inventory</h3><div className="muted pe-sub">Count stock and set product codes.</div></div><span className="toggleline"><span className="muted">Track quantity</span><Switch checked={f.trackInventory} onChange={(v) => set("trackInventory", v)} label="Inventory tracked" /></span></div>
                {f.trackInventory && <div className="inv-sec"><div className="inv-sec-h">Stock by location</div>{stockFields()}</div>}
                <div className="inv-sec"><div className="inv-sec-h">Product codes</div>
                <div className="row">
                  <div className="field"><div className="genrow"><label htmlFor="sku-0">SKU</label><span className="acts"><button className="link" type="button" onClick={() => generate("sku", [0])}>Generate</button></span></div><input id="sku-0" placeholder="Stock keeping unit" value={single.sku} onChange={(e) => setVariant(0, { sku: e.target.value })} {...val.props("sku:0")} /><FieldError k="sku:0" msg={val.err("sku:0")} /></div>
                  <div className="field"><div className="genrow"><label htmlFor="bc-0">Barcode</label><span className="acts"><button className="link" type="button" onClick={() => generate("barcode", [0])}>Generate</button><button className="link" type="button" disabled={!single.sku.trim() && !single.barcode.trim()} onClick={() => setCodesFor(0)}>Preview</button></span></div><input id="bc-0" placeholder="ISBN, UPC, GTIN…" value={single.barcode} onChange={(e) => setVariant(0, { barcode: e.target.value })} {...val.props("barcode:0")} /><FieldError k="barcode:0" msg={val.err("barcode:0")} /></div>
                </div>{f.trackInventory && locs.length > 0 && <><div className="inv-sec-h" style={{ margin: "14px 0 8px" }}>Codes by market</div>{codesByMarket(0, single)}</>}</div>
                {f.trackInventory && <label className="check pe-continue"><input type="checkbox" checked={f.continueSelling} onChange={(e) => set("continueSelling", e.target.checked)} /><span><b>Continue selling when out of stock</b><span className="muted" style={{ display: "block" }}>Customers can still order after the count reaches zero.</span></span></label>}
              </div>
            </>
          )}

          <div className="anchor" id="sec-shipping" />
          <div className="card">
            <div className="cardhead"><h3>Shipping</h3><span className="toggleline"><span className="muted">Physical product</span><Switch checked={f.physical} onChange={(v) => set("physical", v)} label="Physical product" /></span></div>
            {f.physical ? (
              !hasOptions ? (
                <div className="row" style={{ maxWidth: 360 }}>
                  <div className="field"><label>Weight</label><input type="number" min={0} step="0.001" placeholder="0.0" value={single.weight} onChange={(e) => setVariant(0, { weight: e.target.value })} {...val.props("weight:0")} /><FieldError k="weight:0" msg={val.err("weight:0")} /></div>
                  <div className="field" style={{ flex: "0 0 100px", minWidth: 100 }}><label>Unit</label><Select value={unit} onChange={(e) => changeUnit(e.target.value as Unit)}>{(Object.keys(UNIT_G) as Unit[]).map((u) => <option key={u}>{u}</option>)}</Select></div>
                </div>
              ) : <p className="muted">Set the weight for each variant under Variant details below.</p>
            ) : <p className="muted">This product isn’t shipped (for example a digital download or a service), so customers aren’t charged shipping for it.</p>}
          </div>

          {hasOptions && (
          <div className="card" id="sec-variant-details">
            <div className="cardhead"><div><h3>Variant details</h3><div className="muted pe-sub">Image, weight, SKU, barcode and, if needed, a different price for one variant.</div></div></div>
                <div className="vs-bar"><b>{f.variants.length} variant{f.variants.length === 1 ? "" : "s"}</b><span className="acts"><button className="link" type="button" onClick={() => generate("sku")}>Generate missing SKUs</button><button className="link" type="button" onClick={() => generate("barcode")}>Generate missing barcodes</button></span></div>
                <div className="vs-cards" role="tablist" aria-label="Variants">
                  {f.variants.map((v, i) => {
                    const im = f.images.find((x) => x.id === v.imageId);
                    const hue = [...v.title].reduce((a, c) => a + c.charCodeAt(0) * 7, 0) % 360;
                    const price = selected.slice(0, 2).map((m) => (v.prices[m.id]?.amount ? `${m.code} ${v.prices[m.id].amount}` : "")).filter(Boolean).join(" · ");
                    return (
                      <button key={v.title + i} type="button" role="tab" aria-selected={active === i} className={`vs-card ${active === i ? "on" : ""}`} onClick={() => setOpenV(i)}>
                        <span className="vs-thumb" style={im ? undefined : { background: `linear-gradient(135deg,hsl(${hue} 80% 62%),hsl(${(hue + 40) % 360} 75% 48%))` }}>{im ? <img src={im.thumbUrl} alt="" /> : <b>{v.title.slice(0, 2)}</b>}</span>
                        <span className="vs-meta"><b>{v.title}</b><small>{price || "No price yet"}</small></span>
                        {f.trackInventory && <span className="vs-stock">{locs.reduce((a, m) => a + marketQty(v, m.id), 0)}</span>}
                      </button>
                    );
                  })}
                </div>
                {f.variants.map((v, i) => i !== active ? null : (
                  <div key={v.title + i} className="vs-studio" role="tabpanel">
                    <div className="vs-left">
                      <div className="vs-photo" style={f.images.find((x) => x.id === v.imageId) ? undefined : { background: `linear-gradient(135deg,hsl(${[...v.title].reduce((a, c) => a + c.charCodeAt(0) * 7, 0) % 360} 80% 62%),#14172b)` }}>
                        {f.images.find((x) => x.id === v.imageId) ? <img src={f.images.find((x) => x.id === v.imageId)!.url} alt={f.images.find((x) => x.id === v.imageId)!.alt} /> : <span>{v.title}</span>}
                      </div>
                      {f.images.length ? (
                        <div className="vs-pick" role="group" aria-label="Image for this variant">
                          <button type="button" className={!v.imageId ? "on" : ""} onClick={() => setVariant(i, { imageId: null })} aria-label="No image">∅</button>
                          {f.images.map((im) => <button type="button" key={im.id} className={v.imageId === im.id ? "on" : ""} onClick={() => setVariant(i, { imageId: im.id })} aria-label="Use this image"><img src={im.thumbUrl} alt={im.alt} /></button>)}
                        </div>
                      ) : <p className="muted" style={{ margin: 0 }}>Add product images above and save, then pick one for this variant. The storefront shows it when a customer picks this variant.</p>}
                      <div className="vs-qr">
                        <button className="link" type="button" disabled={!v.sku.trim() && !v.barcode.trim()} onClick={() => setCodesFor(i)}>Preview barcode and QR</button>
                        {v.id && <span className="toggleline"><Switch checked={v.qrActive !== false} onChange={async (on) => { try { await api(`/products/variants/${v.id}/qr`, { method: "PUT", json: { active: on } }); setVariant(i, { qrActive: on }); } catch (e) { alert((e as Error).message); } }} label="QR code active" /><span>QR active</span></span>}
                      </div>
                    </div>
                    <div className="vs-right">
                      <section className="vs-sec"><h4>Price</h4>
                        <div className="vs-prices">
                          {selected.map((m) => (
                            <div key={m.id} className="vs-price">
                              <label htmlFor={`pr-${i}-${m.id}`}>{m.name}</label>
                              <div className="vs-money"><span>{m.currency}</span><input id={`pr-${i}-${m.id}`} type="number" step="0.01" min={0} placeholder="0.00" value={v.prices[m.id]?.amount ?? ""} onChange={(e) => setPrice(i, m.id, "amount", e.target.value)} {...val.props(`price:${i}:${m.id}`)} /></div>
                              <FieldError small k={`price:${i}:${m.id}`} msg={val.err(`price:${i}:${m.id}`)} />
                              {f.variants.length > 1 && v.prices[m.id]?.amount && <button type="button" className="link vs-all" onClick={() => setAllPrices(m.id, v.prices[m.id].amount)}>Use for all variants</button>}
                            </div>
                          ))}
                        </div>
                      </section>
                      {f.physical && (
                        <section className="vs-sec"><h4>Weight</h4>
                          <div className="vs-money w"><input id={`wt-${i}`} aria-label={`Weight in ${unit}`} type="number" min={0} step="0.001" placeholder="0.0" value={v.weight} onChange={(e) => setVariant(i, { weight: e.target.value })} {...val.props(`weight:${i}`)} /><span>{unit}</span></div>
                          <FieldError small k={`weight:${i}`} msg={val.err(`weight:${i}`)} />
                        </section>
                      )}
                      <section className="vs-sec"><h4>Codes</h4>
                        <div className="vs-codes">
                          <div className="field"><div className="genrow"><label htmlFor={`sk-${i}`}>SKU</label><span className="acts"><button className="link" type="button" onClick={() => generate("sku", [i])}>Generate</button></span></div>
                            <input id={`sk-${i}`} value={v.sku} onChange={(e) => setVariant(i, { sku: e.target.value })} {...val.props(`sku:${i}`)} />
                            <FieldError small k={`sku:${i}`} msg={val.err(`sku:${i}`)} /></div>
                          <div className="field"><div className="genrow"><label htmlFor={`bc-${i}`}>Barcode</label><span className="acts"><button className="link" type="button" onClick={() => generate("barcode", [i])}>Generate</button></span></div>
                            <input id={`bc-${i}`} value={v.barcode} onChange={(e) => setVariant(i, { barcode: e.target.value })} {...val.props(`barcode:${i}`)} />
                            <FieldError small k={`barcode:${i}`} msg={val.err(`barcode:${i}`)} /></div>
                        </div>
                        {f.trackInventory && selected.length > 0 && <details className="vs-more"><summary>Different SKU or barcode per market</summary>{codesByMarket(i, v)}</details>}
                      </section>
                    </div>
                  </div>
                ))}
          </div>
          )}

          <div className="card">
            <div className="cardhead"><h3>Gift card</h3><span className="toggleline"><span className="muted">This product is a gift card</span><Switch checked={f.isGiftCard} onChange={(v) => setF((c) => {
              // a gift card is not shipped, taxed or counted; switching it off puts back what the product had before
              if (v) { beforeGift.current = { physical: c.physical, chargeTax: c.chargeTax, trackInventory: c.trackInventory }; return { ...c, isGiftCard: true, physical: false, chargeTax: false, trackInventory: false }; }
              return { ...c, isGiftCard: false, ...(beforeGift.current ?? { physical: true, chargeTax: true, trackInventory: true }) };
            })} label="This product is a gift card" /></span></div>
            <p className="muted" style={{ margin: 0 }}>{f.isGiftCard ? "Each variant is a gift card amount (for example £25, £50). When an order is paid, the buyer is emailed a code worth that amount. Nothing is shipped or taxed when it is sold." : "Turn this on to sell gift cards. Each variant becomes an amount customers can buy."}</p>
          </div>

          <div className="anchor" id="sec-seo" />
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
            <button onClick={leave}>Discard</button>
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
            <div className="field"><label>Collections</label><PickList label="collections" placeholder="Choose collections" options={meta?.collections.map((c) => ({ id: c.id, label: c.title })) ?? []} selected={f.collectionIds} onChange={(v) => set("collectionIds", v)} />{!!meta && !meta.collections.length && <span className="muted">No manual collections yet. Create one under Products → Collections.</span>}</div>
            <div className="field" style={{ marginBottom: 0 }}><label>Tags</label><PickList label="tags" allowCreate placeholder="Choose or add tags" options={(meta?.tags ?? []).map((t) => ({ id: t, label: t }))} selected={f.tagsText.split(",").map((t) => t.trim()).filter(Boolean)} onChange={(v) => set("tagsText", v.join(", "))} /></div>
          </div>

          <div className="card">
            <h3>Internal notes</h3>
            <textarea rows={3} value={f.notes} placeholder="Only you and your team see this" onChange={(e) => set("notes", e.target.value)} />
          </div>
        </aside>
      </div>
      {leaveTo && (
        <Modal title="Unsaved changes" onClose={() => setLeaveTo(null)} footer={<><button onClick={() => setLeaveTo(null)}>Keep editing</button><span style={{ display: "flex", gap: 8 }}><button onClick={() => { leaving.current = true; const to = leaveTo; setLeaveTo(null); router.push(new URL(to).pathname + new URL(to).search); }}>Discard changes</button><button className="primary" onClick={() => { goAfterSave.current = new URL(leaveTo).pathname + new URL(leaveTo).search; setLeaveTo(null); save(); }}>Save and leave</button></span></>}>
          <p>You changed this product but haven't saved yet. Save before you leave, or throw the changes away?</p>
        </Modal>
      )}
      {locCodes && f.variants[locCodes.i] && <CodePreview title={`${f.title || "New product"}${f.variants[locCodes.i].title !== "Default" ? ` — ${f.variants[locCodes.i].title}` : ""} — ${locCodes.loc.code}`} sku={f.variants[locCodes.i].stock[locCodes.loc.id]?.sku ?? ""} barcode={f.variants[locCodes.i].stock[locCodes.loc.id]?.barcode ?? ""} onClose={() => setLocCodes(null)} />}
      {codesFor !== null && f.variants[codesFor] && <CodePreview title={`${f.title || "New product"}${f.variants[codesFor].title !== "Default" ? ` — ${f.variants[codesFor].title}` : ""}`} sku={f.variants[codesFor].sku} barcode={f.variants[codesFor].barcode} onClose={() => setCodesFor(null)} />}
    </>
  );
}
