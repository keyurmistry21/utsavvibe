"use client";

import QRCode from "qrcode";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api, money, type Market, type Product } from "@/lib/api";
import { ean13Svg, productQrUrl } from "@/lib/codes";
import { useQrBase } from "@/lib/useQrBase";
import { useApi } from "./hooks";
import { ArrowLeft } from "../Icons";
import { Select } from "../Select";

// Label stocks. "roll" prints one label per page sized to the label; "sheet" tiles labels on A4 label paper.
const SIZES = {
  roll50x25: { name: "Roll 50 × 25 mm", w: 50, h: 25, mode: "roll" },
  roll70x40: { name: "Roll 70 × 40 mm", w: 70, h: 40, mode: "roll" },
  a4x21: { name: "A4 sheet, 21 labels (63.5 × 38.1 mm)", w: 63.5, h: 38.1, mode: "sheet", cols: 3, gapX: 2.5, gapY: 0, mx: 7.2, my: 15.1 },
  a4x65: { name: "A4 sheet, 65 labels (38.1 × 21.2 mm)", w: 38.1, h: 21.2, mode: "sheet", cols: 5, gapX: 2.5, gapY: 0, mx: 4.7, my: 10.7 },
} as const;
type SizeKey = keyof typeof SIZES;

type Row = { key: string; productId: string; product: string; variant: string; opts: string; sku: string; barcode: string; inventory: number; prices: Product["variants"][number]["prices"] };

export function PrintLabels() {
  const { data: products, error } = useApi<Product[]>("/products");
  const { data: markets } = useApi<Market[]>("/markets");
  const [q, setQ] = useState("");
  const [pick, setPick] = useState<Record<string, number>>({}); // variant key -> copies (absent = not selected)
  const [size, setSize] = useState<SizeKey>("roll50x25");
  const [show, setShow] = useState({ title: true, variant: true, sku: true, price: false, barcode: true, qr: false });
  const [marketId, setMarketId] = useState("");
  const [skip, setSkip] = useState(0); // used slots on a partly used sheet
  const [qrs, setQrs] = useState<Record<string, string>>({});

  const rows: Row[] = useMemo(() => (products ?? []).flatMap((p) => p.variants.map((v, i) => ({
    key: v.id ?? `${p.id}:${i}`, productId: p.id, product: p.title, variant: v.title === "Default" ? "" : v.title, opts: Object.entries(v.options ?? {}).map(([k, x]) => `${k}: ${x}`).join(", "),
    sku: v.sku ?? "", barcode: v.barcode ?? "", inventory: v.inventory, prices: v.prices,
  }))), [products]);

  // preselect from ?ids=productId,productId (the Products list "Print labels" button)
  useEffect(() => {
    if (!rows.length) return;
    const ids = new URLSearchParams(location.search).get("ids")?.split(",").filter(Boolean) ?? [];
    if (ids.length) setPick((cur) => Object.keys(cur).length ? cur : Object.fromEntries(rows.filter((r) => ids.includes(r.productId)).map((r) => [r.key, 1])));
  }, [rows]);
  useEffect(() => { if (markets?.length && !marketId) setMarketId(markets[0].id); }, [markets, marketId]);

  const chosen = rows.filter((r) => pick[r.key]);
  const labels = chosen.flatMap((r) => Array.from({ length: pick[r.key] }, () => r));
  const { base: qrBase, local: qrLocal } = useQrBase();
  const qrCode = (r: Row) => r.sku || r.barcode;
  const qrText = (r: Row) => (qrCode(r) && qrBase ? productQrUrl(qrBase, qrCode(r)) : "");
  const qrKey = chosen.map(qrText).filter(Boolean).join("\n");
  useEffect(() => {
    if (!show.qr) return;
    const need = [...new Set(qrKey.split("\n").filter(Boolean))].filter((t) => !qrs[t]);
    need.forEach((t) => QRCode.toDataURL(t, { margin: 1, width: 200, errorCorrectionLevel: "M" }).then((u) => setQrs((c) => ({ ...c, [t]: u }))).catch(() => {}));
  }, [show.qr, qrKey, qrs]);

  const shown = rows.filter((r) => !q.trim() || `${r.product} ${r.variant} ${r.opts} ${r.sku} ${r.barcode}`.toLowerCase().includes(q.trim().toLowerCase()));
  const market = markets?.find((m) => m.id === marketId);
  const S = SIZES[size];
  const missing = chosen.filter((r) => (show.barcode && !r.barcode) || (show.qr && !qrText(r))).length;
  const setCopies = (k: string, n: number) => setPick((c) => ({ ...c, [k]: Math.max(1, Math.min(500, n || 1)) }));
  const toggle = (k: string, on: boolean) => setPick((c) => { const n = { ...c }; if (on) n[k] = n[k] ?? 1; else delete n[k]; return n; });
  const toggleMany = (rs: Row[], on: boolean) => setPick((c) => { const n = { ...c }; rs.forEach((r) => { if (on) n[r.key] = n[r.key] ?? 1; else delete n[r.key]; }); return n; });

  const cells: (Row | null)[] = [...Array(S.mode === "sheet" ? skip : 0).fill(null), ...labels];
  const css = S.mode === "roll"
    ? `@page { size: ${S.w}mm ${S.h}mm; margin: 0 }`
    : `@page { size: A4; margin: ${S.my}mm ${S.mx}mm }`;

  const label = (r: Row | null, i: number) => {
    if (!r) return <div key={i} className="lbl blank" />;
    const bar = show.barcode && r.barcode ? ean13Svg(r.barcode, 2) : null;
    const price = show.price && market ? r.prices[market.id]?.amount : undefined;
    return (
      <div key={i} className="lbl">
        <div className="lbl-text">
          {show.title && <div className="lbl-title">{r.product}</div>}
          {show.variant && r.variant && <div className="lbl-var">{r.opts || r.variant}</div>}
          {show.sku && r.sku && <div className="lbl-sku">{r.sku}</div>}
          {price != null && market && <div className="lbl-price">{money(price, market.currency)}</div>}
        </div>
        <div className="lbl-codes">
          {bar ? <div className="lbl-bar" dangerouslySetInnerHTML={{ __html: bar }} /> : show.barcode && r.barcode ? <div className="lbl-sku">{r.barcode}</div> : null}
          {show.qr && qrs[qrText(r)] && <img className="lbl-qr" src={qrs[qrText(r)]} alt="" />}
        </div>
      </div>
    );
  };

  const groups = [...new Set(shown.map((r) => r.productId))];
  return (
    <>
      <style>{css}</style>
      <div className="crumbbar noprint"><Link href="/admin/products" className="btn-link crumb"><ArrowLeft />Products</Link></div>
      <div className="pagehead noprint"><h2>Print labels</h2><div className="headtools"><button className="primary" disabled={!labels.length} onClick={() => window.print()}>Print {labels.length || ""} label{labels.length === 1 ? "" : "s"}</button></div></div>
      {error && <div className="error noprint">{error}</div>}

      <div className="cols noprint">
        <div>
          <div className="card">
            <div className="row" style={{ alignItems: "end" }}>
              <div className="field grow"><label htmlFor="lb-q">Find products or variants</label><input id="lb-q" value={q} placeholder="Name, SKU or barcode" onChange={(e) => setQ(e.target.value)} /></div>
              <div className="field" style={{ flex: "none" }}><button onClick={() => toggleMany(shown, true)}>Select all{q ? " shown" : ""}</button></div>
              <div className="field" style={{ flex: "none" }}><button onClick={() => setPick({})} disabled={!chosen.length}>Clear</button></div>
            </div>
            {!products && <p className="muted">Loading…</p>}
            {products && !rows.length && <p className="muted">No products yet.</p>}
            <div className="lbltable">
              {groups.map((pid) => {
                const rs = shown.filter((r) => r.productId === pid);
                const all = rs.every((r) => pick[r.key]);
                return (
                  <div key={pid} className="lblgroup">
                    <label className="check"><input type="checkbox" checked={all} onChange={(e) => toggleMany(rs, e.target.checked)} /><b>{rs[0].product}</b></label>
                    {rs.map((r) => (
                      <div key={r.key} className="lblrow">
                        <label className="check"><input type="checkbox" checked={!!pick[r.key]} onChange={(e) => toggle(r.key, e.target.checked)} aria-label={`Select ${r.variant || r.product}`} /><span>{r.opts || r.variant || "Default"}</span></label>
                        <span className="muted lblcodes">{r.sku || "no SKU"} · {r.barcode || "no barcode"}</span>
                        <span className="lblcopies">
                          {pick[r.key] ? <>
                            <input type="number" min={1} max={500} aria-label="Copies" value={pick[r.key]} onChange={(e) => setCopies(r.key, +e.target.value)} />
                            <button className="link" title="Use the stock quantity as the number of labels" disabled={r.inventory < 1} onClick={() => setCopies(r.key, r.inventory)}>Stock ({r.inventory})</button>
                          </> : null}
                        </span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <aside className="sideform">
          <div className="card">
            <h3>Label</h3>
            <div className="field"><label>Label stock</label>
              <Select value={size} onChange={(e) => setSize(e.target.value as SizeKey)}>{Object.entries(SIZES).map(([k, s]) => <option key={k} value={k}>{s.name}</option>)}</Select>
            </div>
            {S.mode === "sheet" && <div className="field"><label htmlFor="lb-skip">Labels already used on the first sheet</label><input id="lb-skip" type="number" min={0} max={S.cols * 20} value={skip} onChange={(e) => setSkip(Math.max(0, +e.target.value || 0))} /></div>}
            {(["title", "variant", "sku", "barcode", "qr", "price"] as const).map((k) => (
              <label key={k} className="check"><input type="checkbox" checked={show[k]} onChange={(e) => setShow({ ...show, [k]: e.target.checked })} />{{ title: "Product name", variant: "Variant (size, color…)", sku: "SKU", barcode: "Barcode", qr: "QR code (opens the product page)", price: "Price" }[k]}</label>
            ))}
            {show.price && markets && <div className="field" style={{ marginTop: 8 }}><label>Price from market</label><Select value={marketId} onChange={(e) => setMarketId(e.target.value)}>{markets.map((m) => <option key={m.id} value={m.id}>{m.code} ({m.currency})</option>)}</Select></div>}
            {missing > 0 && <div className="error">{missing} selected variant{missing === 1 ? " has" : "s have"} no barcode/SKU for the chosen label. Add one in the product editor (Generate) or untick it.</div>}
            {show.qr && qrLocal && <div className="error">QR codes point at localhost, which phones can't open. Set the Public store URL under Online Store → Preferences first.</div>}
            <p className="muted">In the print dialog choose "Margins: None" if the browser adds its own, and scale 100%.</p>
          </div>
        </aside>
      </div>

      {labels.length > 0 && <h3 className="sheet-h noprint">Preview</h3>}
      <div className={`lblsheet ${S.mode}`} style={{ ["--lw" as string]: `${S.w}mm`, ["--lh" as string]: `${S.h}mm`, ...(S.mode === "sheet" ? { ["--cols" as string]: S.cols, ["--gx" as string]: `${S.gapX}mm` } : {}) }}>
        {cells.map(label)}
      </div>
    </>
  );
}
