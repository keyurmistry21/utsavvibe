"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { api } from "@/lib/api";
import { ArrowLeft } from "../Icons";
import { Select } from "../Select";

type Preview = {
  token: string; skippedRows: number; priceColumns: string[];
  markets: { id: string; code: string; name: string; currency: string; suggested: string | null }[];
  products: { handle: string; title: string; status: string; variants: number; images: number; exists: boolean; samplePrice: string }[];
};
type Result = { handle: string; status: "created" | "skipped" | "failed"; message: string; warnings: string[] };
const BATCH = 10;

export function ShopifyImport() {
  const [prev, setPrev] = useState<Preview | null>(null);
  const [fileName, setFileName] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState<Record<string, { on: boolean; source: string }>>({});
  const [images, setImages] = useState(true);
  const [results, setResults] = useState<Result[] | null>(null);
  const [done, setDone] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const choose = async (file: File) => {
    setErr(""); setPrev(null); setResults(null); setBusy(true); setFileName(file.name);
    try {
      if (file.size > 20_000_000) throw new Error("That file is over 20 MB. Export fewer products at a time.");
      const r = await fetch("/api/admin/products/import/preview", { method: "POST", credentials: "same-origin", headers: { "content-type": "text/csv" }, body: await file.text() });
      if (r.status === 401) window.dispatchEvent(new Event("admin:unauthorized"));
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? r.statusText);
      const p = d as Preview;
      const anySuggested = p.markets.some((m) => m.suggested);
      setPick(Object.fromEntries(p.markets.map((m, i) => [m.id, { on: m.suggested ? true : !anySuggested && i === (p.markets.findIndex((x) => x.code === "UK") >= 0 ? p.markets.findIndex((x) => x.code === "UK") : 0), source: m.suggested ?? "base" }])));
      setPrev(p);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  const chosen = prev?.markets.filter((m) => pick[m.id]?.on) ?? [];
  const todo = prev?.products.filter((p) => !p.exists) ?? [];

  const run = async () => {
    if (!prev || !chosen.length) return;
    setErr(""); setBusy(true); setResults([]); setDone(0);
    const all: Result[] = prev.products.filter((p) => p.exists).map((p) => ({ handle: p.handle, status: "skipped", message: "a product with this URL handle already exists", warnings: [] }));
    try {
      for (let i = 0; i < todo.length; i += BATCH) {
        const r = await api<{ results: Result[] }>("/products/import", { method: "POST", json: { token: prev.token, handles: todo.slice(i, i + BATCH).map((p) => p.handle), markets: chosen.map((m) => ({ marketId: m.id, source: pick[m.id].source })), images } });
        all.push(...r.results);
        setResults([...all]); setDone(Math.min(todo.length, i + BATCH));
      }
    } catch (e) { setErr(`${(e as Error).message}. Products imported so far are kept; run the import again to continue (existing ones are skipped).`); } finally { setBusy(false); }
  };

  const created = results?.filter((r) => r.status === "created").length ?? 0;
  const failed = results?.filter((r) => r.status === "failed") ?? [];
  const finished = !!results && !busy;

  return (
    <>
      <div className="crumbbar"><Link href="/admin/products" className="link crumb"><ArrowLeft />Products</Link></div>
      <div className="pagehead"><h2>Import products from Shopify</h2></div>
      {err && <div className="error">{err}</div>}

      <div className="card">
        <h3>1. Export from Shopify</h3>
        <p className="muted" style={{ marginTop: 0 }}>In Shopify admin go to Products → Export → “All products” → “CSV for Excel, Numbers, or other spreadsheet programs”. Then choose that file here. Nothing is saved until you press Import.</p>
        <button disabled={busy} onClick={() => fileRef.current?.click()}>{busy && !prev ? "Reading…" : fileName ? "Choose another file" : "Choose CSV file"}</button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) choose(f); }} />
        {fileName && <span className="muted" style={{ marginLeft: 10 }}>{fileName}</span>}
      </div>

      {prev && !finished && (
        <>
          <div className="card">
            <h3>2. Where to sell and which prices to use</h3>
            <p className="muted" style={{ marginTop: 0 }}>Shopify prices are in one currency. Pick the markets these products should be sold in; each one needs a price column. You can edit prices per market after importing.</p>
            {prev.markets.map((m) => (
              <div key={m.id} className="row" style={{ alignItems: "center" }}>
                <label className="check" style={{ minWidth: 220 }}><input type="checkbox" disabled={busy} checked={!!pick[m.id]?.on} onChange={(e) => setPick({ ...pick, [m.id]: { ...pick[m.id], on: e.target.checked } })} />{m.name} ({m.currency})</label>
                <div className="field grow" style={{ margin: 0 }}>
                  <Select aria-label={`Price column for ${m.name}`} disabled={busy || !pick[m.id]?.on} value={pick[m.id]?.source ?? "base"} onChange={(e) => setPick({ ...pick, [m.id]: { ...pick[m.id], source: e.target.value } })}>
                    <option value="base">Variant Price (the main price column)</option>
                    {prev.priceColumns.map((c) => <option key={c} value={c}>{c}</option>)}
                  </Select>
                </div>
              </div>
            ))}
            {!chosen.length && <p className="error">Choose at least one market.</p>}
            <p className="muted" style={{ marginBottom: 0 }}>Tip: if your Shopify prices are in pounds, tick only the UK market and use “Variant Price”. Set US and Canada prices afterwards, or tick them here to reuse the same numbers.</p>
          </div>

          <div className="card">
            <h3>3. Review</h3>
            <label className="check"><input type="checkbox" disabled={busy} checked={images} onChange={(e) => setImages(e.target.checked)} />Download product images from Shopify (only Shopify’s own image servers are allowed)</label>
            <p><b>{todo.length}</b> product{todo.length === 1 ? "" : "s"} will be created{prev.products.length > todo.length ? `, ${prev.products.length - todo.length} skipped because the URL handle already exists` : ""}.{prev.skippedRows ? ` ${prev.skippedRows} row(s) without a handle were ignored.` : ""}</p>
            <div className="tablescroll" style={{ maxHeight: 280, overflow: "auto" }}>
              <table>
                <thead><tr><th>Product</th><th>Status</th><th style={{ textAlign: "right" }}>Variants</th><th style={{ textAlign: "right" }}>Images</th><th>Result</th></tr></thead>
                <tbody>{prev.products.slice(0, 200).map((p) => <tr key={p.handle}><td><b>{p.title || p.handle}</b><div className="muted">{p.handle}</div></td><td>{p.status}</td><td style={{ textAlign: "right" }}>{p.variants}</td><td style={{ textAlign: "right" }}>{p.images}</td><td className="muted">{p.exists ? "Skipped: already exists" : "Will be created"}</td></tr>)}</tbody>
              </table>
            </div>
            {prev.products.length > 200 && <p className="muted">Showing the first 200 of {prev.products.length}.</p>}
          </div>
          <div className="savebar"><span style={{ flex: 1 }} className="muted">{busy ? `Importing… ${done} of ${todo.length}` : ""}</span><button className="primary" disabled={busy || !chosen.length || !todo.length} onClick={run}>{busy ? "Importing…" : `Import ${todo.length} product${todo.length === 1 ? "" : "s"}`}</button></div>
        </>
      )}

      {results && (
        <div className="card">
          <h3>{finished ? "Import finished" : `Importing… ${done} of ${todo.length}`}</h3>
          {busy && <progress value={done} max={Math.max(1, todo.length)} style={{ width: "100%" }} />}
          <p><b>{created}</b> created · {results.filter((r) => r.status === "skipped").length} skipped · <b style={{ color: failed.length ? "#b42318" : undefined }}>{failed.length}</b> failed</p>
          {finished && <p><Link className="btn-link" href="/admin/products">View products</Link></p>}
          <div className="tablescroll" style={{ maxHeight: 360, overflow: "auto" }}>
            <table>
              <tbody>{results.filter((r) => r.status !== "created" || r.warnings.length).map((r) => <tr key={r.handle}><td><b>{r.handle}</b></td><td><span className={`badge ${r.status === "created" ? "ok" : r.status === "failed" ? "bad" : ""}`}>{r.status}</span></td><td className="muted">{[r.message, ...r.warnings].filter(Boolean).join(" · ")}</td></tr>)}</tbody>
            </table>
          </div>
          <p className="muted">Imported products keep Shopify’s status (active, draft or archived). Review them before sharing the link.</p>
        </div>
      )}
    </>
  );
}
