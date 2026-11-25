"use client";

import { useState } from "react";
import Link from "next/link";
import { api, money } from "@/lib/api";
import { toast } from "@/lib/toast";
import { useCan } from "@/lib/perms";
import { useApi } from "./hooks";
import { Modal } from "./Modal";
import { Drawer } from "./Drawer";
import { Select } from "../Select";

type Loc = { id: string; name: string; marketId: string | null; marketCode: string; marketName: string; regionCode: string | null; regionName: string; isDefault: boolean };
type Row = { variantId: string; productId: string; thumbUrl: string | null; product: string; variant: string; sku: string | null; tracked: boolean; byLocation: Record<string, number>; unassigned: number; total: number };
type Move = { kind: "stock" | "price"; currency?: string; oldAmount?: number; newAmount?: number; id: string; createdAt: string; delta: number; source: string; reason: string; actorEmail: string; reverted: boolean; productId: string | null; product: string; variant: string; where: string };
type Transfer = { id: string; fromName: string; toName: string; fromLocationId: string; toLocationId: string; status: "in_transit" | "received" | "cancelled"; note: string; createdAt: string; createdByEmail: string; items: { id: string; title: string; quantity: number }[] };

const PAL = ["#f97203", "#2f80ed", "#27ae60", "#9b51e0", "#eb5757", "#f2c94c", "#00b8d9", "#ff6b9a"];

// Stock is counted at locations (Settings → Locations). Each location sits in a market and a state/province of it, so the columns
// read Market → Region → Location: the same places that carry price and tax.
export function Inventory() {
  const { can } = useCan();
  const manage = can("products.manage");
  const [tab, setTab] = useState<"stock" | "transfers" | "history">("stock");
  const [q, setQ] = useState("");
  const [f, setF] = useState<"all" | "low" | "out">("all");
  const [mkt, setMkt] = useState(""); // market code: show only its locations
  const { data, error, reload } = useApi<{ locations: Loc[]; rows: Row[] }>(`/inventory?q=${encodeURIComponent(q)}`);
  const { data: transfers, reload: reloadT } = useApi<Transfer[]>("/inventory/transfers");
  const { data: history, reload: reloadH } = useApi<Move[]>("/inventory/history");
  const [newT, setNewT] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const allLocs = data?.locations ?? [];
  const markets = [...new Map(allLocs.filter((l) => l.marketCode).map((l) => [l.marketCode, l.marketName])).entries()];
  // locations of the chosen market, ordered Market → Region → name
  const locs = allLocs.filter((l) => !mkt || l.marketCode === mkt).sort((a, b) => a.marketCode.localeCompare(b.marketCode) || a.regionName.localeCompare(b.regionName) || a.name.localeCompare(b.name));
  const rows = data?.rows ?? [];
  const totalUnits = rows.reduce((a, r) => a + r.total, 0);
  const lowCount = rows.filter((r) => r.total > 0 && r.total <= 5).length;
  const outCount = rows.filter((r) => r.total <= 0).length;
  const shown = rows.filter((r) => f === "all" || (f === "low" ? r.total > 0 && r.total <= 5 : r.total <= 0));
  const unassignedTotal = rows.reduce((a, r) => a + r.unassigned, 0);
  // ---- view model for the cards and the hero
  const scoped = (r: Row) => (mkt ? locs.reduce((a, l) => a + (r.byLocation[l.id] ?? 0), 0) : r.total);
  const [editing, setEditing] = useState<string | null>(null);
  const variantsN = rows.length;
  const lowN = rows.filter((r) => scoped(r) > 0 && scoped(r) <= 5).length;
  const outN = rows.filter((r) => scoped(r) <= 0).length;
  const healthy = variantsN - lowN - outN;
  const units = rows.reduce((a, r) => a + scoped(r), 0);
  const perLoc: Record<string, number> = {};
  for (const r of rows) for (const l of locs) perLoc[l.id] = (perLoc[l.id] ?? 0) + (r.byLocation[l.id] ?? 0);
  const maxLoc = Math.max(1, ...Object.values(perLoc));
  const CIRC = 2 * Math.PI * 48;
  let off = 0;
  const ringSegs = ([["ok", healthy], ["low", lowN], ["out", outN]] as const).filter(([, n]) => n > 0).map(([cls, n]) => { const len = (n / Math.max(1, variantsN)) * CIRC; const seg = { cls, len: Math.max(0, len - 3), off }; off += len; return seg; });
  const products = (() => {
    const m = new Map<string, { id: string; title: string; thumbUrl: string | null; variants: Row[] }>();
    for (const r of shown) { const g = m.get(r.productId) ?? { id: r.productId, title: r.product, thumbUrl: r.thumbUrl, variants: [] }; g.variants.push(r); m.set(r.productId, g); }
    return [...m.values()];
  })();

  // header groups: consecutive locations in the same market, then the same region
  const groups = <K extends keyof Loc>(key: K, label: (l: Loc) => string) => locs.reduce<{ label: string; n: number }[]>((acc, l, i) => { const lab = label(l); const prev = locs[i - 1]; if (i && prev && label(prev) === lab && prev.marketCode === l.marketCode) acc[acc.length - 1].n++; else acc.push({ label: lab, n: 1 }); return acc; }, []);
  const marketGroups = locs.reduce<{ label: string; n: number }[]>((acc, l, i) => { if (i && locs[i - 1].marketCode === l.marketCode) acc[acc.length - 1].n++; else acc.push({ label: l.marketName || "No market", n: 1 }); return acc; }, []);
  const regionGroups = groups("regionName", (l) => l.regionName || "–");
  const showRegions = locs.some((l) => l.regionName);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setErr(""); setMsg("");
    try { await fn(); setMsg(ok); if (ok) toast.success(ok); reload(); reloadT(); reloadH(); } catch (e) { setErr((e as Error).message); }
  };

  return (
    <>
      <div className="pagehead">
        <div><h2>Inventory</h2><div className="muted">Stock at each location, grouped by market and state or province.</div></div>
        {manage && allLocs.length > 1 && <button className="primary" onClick={() => setNewT(true)}>Transfer stock</button>}
      </div>
      <div className="tabs" role="tablist"><button className={tab === "stock" ? "on" : ""} onClick={() => setTab("stock")}>Stock by location</button><button className={tab === "history" ? "on" : ""} onClick={() => setTab("history")}>History</button><button className={tab === "transfers" ? "on" : ""} onClick={() => setTab("transfers")}>Transfers{transfers?.some((t) => t.status === "in_transit") ? ` (${transfers.filter((t) => t.status === "in_transit").length} on the way)` : ""}</button></div>
      {error && <div className="error">{error}</div>}
      {err && <div className="error">{err}</div>}
      {msg && <div className="okmsg">{msg}</div>}

      {tab === "stock" && (
        <div className="iv">
          {/* hero: stock health ring + the numbers that matter */}
          <section className="iv-hero" aria-label="Stock summary">
            <div className="iv-ring" role="img" aria-label={`${healthy} healthy, ${lowN} low, ${outN} out of stock`}>
              <svg viewBox="0 0 120 120">
                <circle cx="60" cy="60" r="48" className="iv-ring-bg" />
                {ringSegs.map((g) => <circle key={g.cls} cx="60" cy="60" r="48" className={`iv-ring-seg ${g.cls}`} strokeDasharray={`${g.len} ${CIRC - g.len}`} strokeDashoffset={-g.off} />)}
              </svg>
              <div className="iv-ring-mid"><b>{units}</b><span>units</span></div>
            </div>
            <div className="iv-stats">
              <button className={`iv-stat ok ${f === "all" ? "on" : ""}`} onClick={() => setF("all")}><i /><b>{variantsN}</b><span>Items tracked</span></button>
              <button className={`iv-stat low ${f === "low" ? "on" : ""}`} onClick={() => setF(f === "low" ? "all" : "low")}><i /><b>{lowN}</b><span>Running low</span></button>
              <button className={`iv-stat out ${f === "out" ? "on" : ""}`} onClick={() => setF(f === "out" ? "all" : "out")}><i /><b>{outN}</b><span>Sold out</span></button>
            </div>
            <div className="iv-where" aria-label="Where your stock is">
              <div className="iv-where-h">Where your stock is</div>
              {locs.length === 0 && <div className="muted">Add a location in Settings → Locations.</div>}
              {locs.map((l, i) => {
                const n = perLoc[l.id] ?? 0;
                return (
                  <div key={l.id} className="iv-loc" style={{ ["--c" as string]: PAL[i % PAL.length] }}>
                    <div className="iv-loc-top"><span className="iv-dot" /><b>{l.name}</b><em>{n}</em></div>
                    <div className="iv-loc-sub">{[l.regionName, l.marketCode].filter(Boolean).join(" · ") || "No state or province"}</div>
                    <div className="iv-bar"><span style={{ width: `${Math.max(n ? 4 : 0, Math.round((n / maxLoc) * 100))}%` }} /></div>
                  </div>
                );
              })}
            </div>
          </section>

          {manage && unassignedTotal > 0 && allLocs.length > 0 && (
            <div className="notice" style={{ margin: "14px 0" }}>
              {unassignedTotal} unit{unassignedTotal === 1 ? "" : "s"} are counted for a market but not at any location yet.{" "}
              {allLocs.map((l) => <button key={l.id} className="link" style={{ marginRight: 12 }} onClick={() => confirm(`Put all unassigned stock for ${l.name}'s market on ${l.name}?`) && act(async () => { const r = await api<{ moved: number }>("/inventory/assign-all", { method: "POST", json: { locationId: l.id } }); setMsg(`${r.moved} units assigned to ${l.name}.`); }, "")}>Assign to {l.name}</button>)}
            </div>
          )}

          <div className="iv-bar-tools">
            <div className="searchfield"><svg viewBox="0 0 20 20"><circle cx="9" cy="9" r="6" /><path d="m14 14 4 4" /></svg><input id="inv-q" aria-label="Search products" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products" /></div>
            {markets.length > 1 && <div className="inv-chips" role="group" aria-label="Market"><button className={!mkt ? "on" : ""} onClick={() => setMkt("")}>All markets</button>{markets.map(([code, name]) => <button key={code} className={mkt === code ? "on" : ""} onClick={() => setMkt(code)}>{name}</button>)}</div>}
            <span className="muted iv-count">{products.length} product{products.length === 1 ? "" : "s"}</span>
          </div>

          <div className="iv-list">
            {products.map((p) => {
              const total = p.variants.reduce((a, v) => a + scoped(v), 0);
              const worst = p.variants.some((v) => scoped(v) <= 0) ? "out" : p.variants.some((v) => scoped(v) <= 5) ? "low" : "ok";
              const byLoc = locs.map((l, i) => ({ l, i, n: p.variants.reduce((a, v) => a + (v.byLocation[l.id] ?? 0), 0) })).filter((x) => x.n > 0);
              return (
                <button key={p.id} className={`iv-row ${worst}`} onClick={() => setEditing(p.id)} aria-label={`Edit stock of ${p.title}`}>
                  <span className="iv-thumb">{p.thumbUrl ? <img src={p.thumbUrl} alt="" /> : <span aria-hidden>📦</span>}</span>
                  <span className="iv-main">
                    <b>{p.title}</b>
                    <span className="iv-vars">{p.variants.map((v) => { const n = scoped(v); return <em key={v.variantId} className={n <= 0 ? "out" : n <= 5 ? "low" : ""}>{v.variant || "Default"} {n}</em>; })}</span>
                  </span>
                  <span className="iv-pills">
                    {byLoc.slice(0, 3).map((x) => <span key={x.l.id} className="iv-pill" style={{ ["--c" as string]: PAL[x.i % PAL.length] }}><i />{x.l.name}<b>{x.n}</b></span>)}
                    {byLoc.length > 3 && <span className="iv-pill more">+{byLoc.length - 3}</span>}
                    {!byLoc.length && <span className="iv-pill none">No stock anywhere</span>}
                  </span>
                  <span className={`iv-total ${worst}`}><b>{total}</b><small>{worst === "out" ? "sold out" : worst === "low" ? "low" : "in stock"}</small></span>
                  <svg className="iv-go" viewBox="0 0 24 24" aria-hidden><path d="M9 6l6 6-6 6" /></svg>
                </button>
              );
            })}
          </div>
          {data && !products.length && (
            <div className="iv-empty"><div aria-hidden>✨</div><b>{f === "all" && !q ? "No products yet" : "Nothing matches"}</b><span>{f === "all" && !q ? "Add a product and its stock shows up here." : "Try another search or filter."}</span></div>
          )}
        </div>
      )}

      {tab === "history" && (
        <div className="card inv-card">
          <div className="inv-toolbar"><span className="muted">Every stock and price change made by hand. If one was a mistake, press Restore to put it back.</span></div>
          <div className="inv-scroll">
            <table className="inv-table">
              <thead><tr><th>When</th><th>Product</th><th>Where</th><th className="r">Change</th><th>What happened</th><th /></tr></thead>
              <tbody>
                {history?.map((h) => (
                  <tr key={`${h.kind}-${h.id}`} className={h.reverted ? "inv-undone" : ""}>
                    <td>{new Date(h.createdAt).toLocaleString()}<div className="muted">{h.actorEmail}</div></td>
                    <td>{h.productId ? <Link href={`/admin/products/${h.productId}`} className="lnk"><b>{h.product}</b></Link> : <b>{h.product}</b>}{h.variant && <span className="invvar">{h.variant}</span>}</td>
                    <td>{h.where || "–"}</td>
                    <td className="r">{h.kind === "price" ? <span className="pricechg">{money(h.oldAmount ?? 0, h.currency ?? "")} → <b>{money(h.newAmount ?? 0, h.currency ?? "")}</b></span> : <span className={`pill ${h.delta > 0 ? "ok" : "out"}`}>{h.delta > 0 ? "+" : ""}{h.delta}</span>}</td>
                    <td>{h.kind === "price" ? (h.source === "restore" ? "Price put back" : h.source === "prices" ? "Price changed in Prices by market" : "Price edited on product") : h.source === "restore" ? "Put back" : h.source === "product" ? "Edited on product" : h.source === "scan" ? "Scanned label" : "Set on Inventory"}{h.reason && h.source !== "restore" && h.source !== "product" && h.source !== "scan" ? <div className="muted">{h.reason}</div> : null}{h.source === "restore" && <div className="muted">{h.reason}</div>}</td>
                    <td className="r">{h.source === "restore" ? null : h.reverted ? <span className="muted">Put back</span> : manage && <button className="link" onClick={() => confirm(h.kind === "price" ? `Put the price back to ${money(h.oldAmount ?? 0, h.currency ?? "")}?` : `Put back this change (${h.delta > 0 ? "remove" : "add"} ${Math.abs(h.delta)})?`) && act(() => api(`/inventory/history/${h.id}/restore${h.kind === "price" ? "?kind=price" : ""}`, { method: "POST" }), h.kind === "price" ? "Price put back." : "Stock put back.")}>Restore</button>}</td>
                  </tr>
                ))}
                {history && !history.length && <tr><td colSpan={6} className="inv-empty">No changes yet. Stock and price changes will be listed here.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {tab === "transfers" && (
        <div className="card">
          <table>
            <thead><tr><th>Date</th><th>From</th><th>To</th><th>Items</th><th>Status</th><th /></tr></thead>
            <tbody>
              {transfers?.map((t) => (
                <tr key={t.id}>
                  <td>{new Date(t.createdAt).toLocaleDateString()}<div className="muted">{t.createdByEmail}</div></td>
                  <td>{t.fromName}</td><td>{t.toName}</td>
                  <td>{t.items.map((i) => `${i.quantity} × ${i.title}`).join(", ")}{t.note && <div className="muted">{t.note}</div>}</td>
                  <td><span className={`badge ${t.status === "received" ? "good" : t.status === "cancelled" ? "" : "warn"}`}>{t.status === "in_transit" ? "On the way" : t.status}</span></td>
                  <td className="r">{manage && t.status === "in_transit" && <><button className="link" onClick={() => act(() => api(`/inventory/transfers/${t.id}/receive`, { method: "POST" }), "Transfer received.")}>Receive</button>{" "}<button className="link" onClick={() => confirm("Cancel and return the stock to the sender?") && act(() => api(`/inventory/transfers/${t.id}/cancel`, { method: "POST" }), "Transfer cancelled.")}>Cancel</button></>}</td>
                </tr>
              ))}
              {transfers && !transfers.length && <tr><td colSpan={6}>No transfers yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {editing && (() => {
        const vs = rows.filter((r) => r.productId === editing);
        if (!vs.length) return null;
        return (
          <Drawer title={vs[0].product} onClose={() => setEditing(null)} footer={<><Link href={`/admin/products/${editing}`} className="iv-edit">Open product page →</Link><button onClick={() => setEditing(null)}>Done</button></>}>
            <div className="iv-dr">
              {vs.map((v) => (
                <section key={v.variantId} className="iv-var">
                  <div className="iv-var-h"><b>{v.variant || "Stock"}</b>{v.sku && <code>{v.sku}</code>}<span className="iv-var-tot">{scoped(v)} in stock</span></div>
                  <div className="iv-tiles">
                    {locs.map((l, i) => {
                      const n = v.byLocation[l.id] ?? 0;
                      const set = (to: number) => to !== n && act(() => api("/inventory/adjust", { method: "POST", json: { variantId: v.variantId, locationId: l.id, delta: to - n, reason: "Set in inventory" } }), "Stock updated.");
                      return (
                        <div key={l.id} className={`iv-t ${n <= 0 ? "zero" : n <= 5 ? "lowv" : ""}`} style={{ ["--c" as string]: PAL[i % PAL.length] }}>
                          <div className="iv-t-name"><span className="iv-dot" />{l.name}</div>
                          <div className="iv-t-sub">{[l.regionName, l.marketCode].filter(Boolean).join(" · ") || "–"}</div>
                          {manage ? (
                            <div className="iv-step">
                              <button type="button" aria-label={`Remove one at ${l.name}`} disabled={n <= 0} onClick={() => set(n - 1)}>−</button>
                              <input type="number" min={0} defaultValue={n} key={`${v.variantId}-${l.id}-${n}`} aria-label={`Stock of ${v.product} ${v.variant} at ${l.name}`} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} onBlur={(e) => set(Math.max(0, parseInt(e.target.value || "0") || 0))} />
                              <button type="button" aria-label={`Add one at ${l.name}`} onClick={() => set(n + 1)}>+</button>
                            </div>
                          ) : <div className="iv-num">{n}</div>}
                        </div>
                      );
                    })}
                  </div>
                  {v.unassigned > 0 && <div className="iv-un">{v.unassigned} not at any location yet</div>}
                </section>
              ))}
            </div>
          </Drawer>
        );
      })()}

      {newT && data && <TransferModal locations={allLocs} rows={data.rows} onClose={() => setNewT(false)} onDone={() => { setNewT(false); setMsg("Transfer created. The stock is on the way."); reload(); reloadT(); setTab("transfers"); }} />}
    </>
  );
}

function TransferModal({ locations, rows, onClose, onDone }: { locations: Loc[]; rows: Row[]; onClose: () => void; onDone: () => void }) {
  const [from, setFrom] = useState(locations[0]?.id ?? "");
  const [to, setTo] = useState(locations[1]?.id ?? "");
  const [lines, setLines] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const label = (l: Loc) => `${l.name}${l.regionName ? ` · ${l.regionName}` : ""}${l.marketCode ? ` (${l.marketCode})` : ""}`;
  const here = rows.filter((r) => (r.byLocation[from] ?? 0) > 0);
  const items = Object.entries(lines).map(([variantId, q]) => ({ variantId, quantity: parseInt(q) || 0 })).filter((i) => i.quantity > 0);
  const save = async () => {
    if (!items.length) return setErr("Enter a quantity for at least one item");
    try { await api("/inventory/transfers", { method: "POST", json: { fromLocationId: from, toLocationId: to, items, note } }); onDone(); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <Modal title="Transfer stock" onClose={onClose} wide dismissOnScrim={false} footer={<><span /><span style={{ display: "flex", gap: 8 }}><button onClick={onClose}>Cancel</button><button className="primary" onClick={save}>Send transfer</button></span></>}>
      {err && <div className="error">{err}</div>}
      <div className="row">
        <div className="field"><label>From</label><Select value={from} onChange={(e) => { setFrom(e.target.value); setLines({}); }}>{locations.map((l) => <option key={l.id} value={l.id}>{label(l)}</option>)}</Select></div>
        <div className="field"><label>To</label><Select value={to} onChange={(e) => setTo(e.target.value)}>{locations.filter((l) => l.id !== from).map((l) => <option key={l.id} value={l.id}>{label(l)}</option>)}</Select></div>
      </div>
      <table>
        <thead><tr><th>Item</th><th className="r">At sender</th><th className="r">Send</th></tr></thead>
        <tbody>
          {here.map((r) => <tr key={r.variantId}><td>{r.product}{r.variant ? ` — ${r.variant}` : ""}</td><td className="r">{r.byLocation[from]}</td><td className="r"><input style={{ width: 80 }} type="number" min={0} max={r.byLocation[from]} value={lines[r.variantId] ?? ""} onChange={(e) => setLines({ ...lines, [r.variantId]: e.target.value })} aria-label={`Quantity of ${r.product} to send`} /></td></tr>)}
          {!here.length && <tr><td colSpan={3}>Nothing in stock at this location. Assign or add stock first.</td></tr>}
        </tbody>
      </table>
      <div className="field" style={{ marginTop: 12 }}><label htmlFor="tr-note">Note (optional)</label><input id="tr-note" value={note} onChange={(e) => setNote(e.target.value)} /></div>
    </Modal>
  );
}
