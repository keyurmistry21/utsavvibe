"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api, toMajor, toMinor, type StockMarket } from "@/lib/api";
import { useCan } from "@/lib/perms";
import { useApi } from "./hooks";
import { useUnsavedGuard } from "./unsaved";
import { Select } from "../Select";
import { ArrowLeft } from "../Icons";

type Data = { market: { id: string; code: string; currency: string }; products: { id: string; title: string; status: string; thumbUrl: string | null; variants: { id: string; title: string; amount: number | null; compareAt: number | null }[] }[] };

// Every price in one market on one screen, edited in place. Change many at once (for example every 311 to 411).
export function PriceList() {
  const { data: markets, error } = useApi<StockMarket[]>("/products/stock/markets");
  if (error) return <div className="error">{error}</div>;
  if (!markets) return null;
  if (!markets.length) return <div className="card muted">Add a market first.</div>;
  return <PriceTable markets={markets} />;
}

function PriceTable({ markets }: { markets: StockMarket[] }) {
  const { can } = useCan();
  const manage = can("products.manage");
  const [marketId, setMarketId] = useState(markets[0].id);
  const [q, setQ] = useState("");
  const { data, error, reload } = useApi<Data>(`/products/prices/list?marketId=${marketId}&q=${encodeURIComponent(q)}`);
  // edits keyed by variant id: [price, compare-at] as typed
  const [edits, setEdits] = useState<Record<string, { amount?: string; compareAt?: string }>>({});
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [pct, setPct] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => { setEdits({}); }, [marketId]);

  const rows = useMemo(() => (data?.products ?? []).flatMap((p) => p.variants.filter((v) => v.amount != null).map((v) => ({ p, v }))), [data]);
  const cur = (v: { id: string; amount: number | null }) => edits[v.id]?.amount ?? toMajor(v.amount ?? 0);
  const curCmp = (v: { id: string; compareAt: number | null }) => edits[v.id]?.compareAt ?? (v.compareAt ? toMajor(v.compareAt) : "");
  const set = (id: string, k: "amount" | "compareAt", val: string) => setEdits((e) => ({ ...e, [id]: { ...e[id], [k]: val } }));
  const changed = rows.filter(({ v }) => edits[v.id] && (toMinor(cur(v)) !== v.amount || (curCmp(v) ? toMinor(curCmp(v)) : null) !== v.compareAt));

  const replaceAll = () => {
    const a = toMinor(from), b = toMinor(to);
    if (!from || !to || !b) return setErr("Enter the old price and the new price");
    const next = { ...edits };
    let n = 0;
    for (const { v } of rows) if (toMinor(cur(v)) === a) { next[v.id] = { ...next[v.id], amount: to }; n++; }
    setEdits(next); setErr(""); setMsg(n ? `${n} price${n === 1 ? "" : "s"} changed from ${from} to ${to}. Check them and press Save.` : "No price matches that amount.");
  };
  const adjust = () => {
    const p = parseFloat(pct);
    if (!p) return setErr("Enter a percentage, like 10 or -5");
    const next = { ...edits };
    for (const { v } of rows) next[v.id] = { ...next[v.id], amount: toMajor(Math.max(0, Math.round(toMinor(cur(v)) * (1 + p / 100)))) };
    setEdits(next); setErr(""); setMsg(`All prices changed by ${p}%. Check them and press Save.`);
  };
  const dirty = changed.length > 0;
  const save = async (): Promise<boolean> => {
    setSaving(true); setErr(""); setMsg("");
    let ok = false;
    try {
      const r = await api<{ updated: number }>("/products/prices/list", { method: "PUT", json: { marketId, rows: changed.map(({ v }) => ({ variantId: v.id, amount: toMinor(cur(v)), compareAt: curCmp(v) ? toMinor(curCmp(v)) : null })) } });
      setMsg(`${r.updated} price${r.updated === 1 ? "" : "s"} saved.`); setEdits({}); reload(); ok = true;
    } catch (e) { setErr((e as Error).message); }
    setSaving(false);
    return ok;
  };
  const { guard } = useUnsavedGuard(dirty, save);

  return (
    <>
      {guard}
      <div className="pagehead">
        <div><Link className="btn-link" href="/admin/products"><ArrowLeft /> Products</Link><h2>Prices by market</h2><div className="muted">Edit every price for one market on one screen. Each market keeps its own prices and currency.</div></div>
        {manage && <button className="primary" disabled={saving || !changed.length} onClick={save}>{saving ? "Saving…" : `Save${changed.length ? ` ${changed.length} change${changed.length === 1 ? "" : "s"}` : ""}`}</button>}
      </div>
      {err && <div className="error">{err}</div>}
      {msg && <div className="okmsg">{msg}</div>}
      {error && <div className="error">{error}</div>}
      <div className="card">
        <div className="row">
          <div className="field"><label>Market</label><Select value={marketId} onChange={(e) => setMarketId(e.target.value)}>{markets.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.code})</option>)}</Select></div>
          <div className="field"><label htmlFor="pl-q">Search products</label><input id="pl-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Product name" /></div>
        </div>
        {manage && (
          <div className="row" style={{ alignItems: "flex-end" }}>
            <div className="field"><label htmlFor="pl-from">Change every price of</label><input id="pl-from" inputMode="decimal" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="311.00" /></div>
            <div className="field"><label htmlFor="pl-to">to</label><input id="pl-to" inputMode="decimal" value={to} onChange={(e) => setTo(e.target.value)} placeholder="411.00" /></div>
            <button onClick={replaceAll}>Apply</button>
            <div className="field"><label htmlFor="pl-pct">Or raise / lower all by %</label><input id="pl-pct" inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} placeholder="10 or -5" /></div>
            <button onClick={adjust}>Apply</button>
          </div>
        )}
        <table>
          <thead><tr><th>Product</th><th className="r">Price ({data?.market.currency ?? ""})</th><th className="r">Compare at</th></tr></thead>
          <tbody>
            {rows.map(({ p, v }) => {
              const dirty = changed.some((c) => c.v.id === v.id);
              return (
                <tr key={v.id} className={dirty ? "dirty" : ""}>
                  <td><Link href={`/admin/products/${p.id}`} className="invprod">{p.thumbUrl ? <img src={p.thumbUrl} alt="" width={36} height={36} /> : <span className="invthumb" />}<span><b>{p.title}</b>{v.title !== "Default" && <span className="muted" style={{ display: "block" }}>{v.title}</span>}{p.status !== "active" && <span className="badge" style={{ marginLeft: 6 }}>{p.status}</span>}</span></Link></td>
                  <td className="r"><input className="invset" style={{ width: 110 }} inputMode="decimal" disabled={!manage} value={cur(v)} onChange={(e) => set(v.id, "amount", e.target.value)} aria-label={`Price of ${p.title} ${v.title}`} /></td>
                  <td className="r"><input className="invset" style={{ width: 110 }} inputMode="decimal" disabled={!manage} value={curCmp(v)} onChange={(e) => set(v.id, "compareAt", e.target.value)} placeholder="–" aria-label={`Compare at price of ${p.title} ${v.title}`} /></td>
                </tr>
              );
            })}
            {data && !rows.length && <tr><td colSpan={3} className="muted">No products are sold in this market.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
