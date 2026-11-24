"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useCan } from "@/lib/perms";
import { useApi } from "./hooks";
import { Modal } from "./Modal";
import { Select } from "../Select";

type Loc = { id: string; name: string; isDefault: boolean };
type Row = { variantId: string; product: string; variant: string; sku: string | null; tracked: boolean; byLocation: Record<string, number>; unassigned: number; total: number };
type Transfer = { id: string; fromName: string; toName: string; fromLocationId: string; toLocationId: string; status: "in_transit" | "received" | "cancelled"; note: string; createdAt: string; createdByEmail: string; items: { id: string; title: string; quantity: number }[] };

export function Inventory() {
  const { can } = useCan();
  const manage = can("products.manage");
  const [tab, setTab] = useState<"stock" | "transfers">("stock");
  const [q, setQ] = useState("");
  const { data, error, reload } = useApi<{ locations: Loc[]; rows: Row[] }>(`/inventory?q=${encodeURIComponent(q)}`);
  const { data: transfers, reload: reloadT } = useApi<Transfer[]>("/inventory/transfers");
  const [adj, setAdj] = useState<{ row: Row; loc: Loc } | null>(null);
  const [newT, setNewT] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const locs = data?.locations ?? [];
  const unassignedTotal = data?.rows.reduce((a, r) => a + r.unassigned, 0) ?? 0;

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setErr(""); setMsg("");
    try { await fn(); setMsg(ok); reload(); reloadT(); } catch (e) { setErr((e as Error).message); }
  };

  return (
    <>
      <div className="pagehead">
        <div><h2>Inventory</h2><div className="muted">Stock at each location, and moving stock between them.</div></div>
        {manage && locs.length > 1 && <button className="primary" onClick={() => setNewT(true)}>Transfer stock</button>}
      </div>
      <div className="tabs" role="tablist"><button className={tab === "stock" ? "on" : ""} onClick={() => setTab("stock")}>Stock by location</button><button className={tab === "transfers" ? "on" : ""} onClick={() => setTab("transfers")}>Transfers{transfers?.some((t) => t.status === "in_transit") ? ` (${transfers.filter((t) => t.status === "in_transit").length} on the way)` : ""}</button></div>
      {error && <div className="error">{error}</div>}
      {err && <div className="error">{err}</div>}
      {msg && <div className="okmsg">{msg}</div>}

      {tab === "stock" && (
        <>
          {manage && unassignedTotal > 0 && locs.length > 0 && (
            <div className="notice" style={{ marginBottom: 12 }}>
              {unassignedTotal} unit{unassignedTotal === 1 ? "" : "s"} are counted for a market but not at any location yet.{" "}
              {locs.map((l) => <button key={l.id} className="link" style={{ marginRight: 12 }} onClick={() => confirm(`Put all unassigned stock for ${l.name}'s market on ${l.name}?`) && act(async () => { const r = await api<{ moved: number }>("/inventory/assign-all", { method: "POST", json: { locationId: l.id } }); setMsg(`${r.moved} units assigned to ${l.name}.`); }, "")}>Assign to {l.name}</button>)}
            </div>
          )}
          <div className="card">
            <div className="field"><label htmlFor="inv-q">Search products</label><input id="inv-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Product name" /></div>
            <table>
              <thead><tr><th>Product</th><th>SKU</th>{locs.map((l) => <th key={l.id} className="r">{l.name}</th>)}<th className="r">Unassigned</th><th className="r">Total</th></tr></thead>
              <tbody>
                {data?.rows.map((r) => (
                  <tr key={r.variantId}>
                    <td><b>{r.product}</b>{r.variant && <div className="muted">{r.variant}</div>}</td>
                    <td>{r.sku ?? "–"}</td>
                    {locs.map((l) => {
                      const n = r.byLocation[l.id] ?? 0;
                      return <td key={l.id} className="r"><span className={n <= 0 ? "dim" : n <= 5 ? "lowtag" : ""}>{n}</span>{manage && <button className="link" style={{ marginLeft: 8 }} onClick={() => setAdj({ row: r, loc: l })} aria-label={`Adjust ${r.product} at ${l.name}`}>Adjust</button>}</td>;
                    })}
                    <td className="r dim">{r.unassigned || "–"}</td>
                    <td className="r strong">{r.total}</td>
                  </tr>
                ))}
                {data && !data.rows.length && <tr><td colSpan={locs.length + 4}>No products found.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
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

      {adj && <AdjustModal row={adj.row} loc={adj.loc} onClose={() => setAdj(null)} onDone={() => { setAdj(null); setMsg("Stock updated."); reload(); }} />}
      {newT && data && <TransferModal locations={locs} rows={data.rows} onClose={() => setNewT(false)} onDone={() => { setNewT(false); setMsg("Transfer created. The stock is on the way."); reload(); reloadT(); setTab("transfers"); }} />}
    </>
  );
}

function AdjustModal({ row, loc, onClose, onDone }: { row: Row; loc: Loc; onClose: () => void; onDone: () => void }) {
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const save = async () => {
    const n = parseInt(delta);
    if (!n) return setErr("Enter a quantity, like 10 to add or -2 to remove");
    try { await api("/inventory/adjust", { method: "POST", json: { variantId: row.variantId, locationId: loc.id, delta: n, reason } }); onDone(); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <Modal title={`Adjust stock at ${loc.name}`} onClose={onClose} footer={<><span /><span style={{ display: "flex", gap: 8 }}><button onClick={onClose}>Cancel</button><button className="primary" onClick={save}>Save</button></span></>}>
      <p><b>{row.product}</b>{row.variant ? ` — ${row.variant}` : ""} · now {row.byLocation[loc.id] ?? 0} here</p>
      {err && <div className="error">{err}</div>}
      <div className="field"><label htmlFor="adj-d">Add or remove (use a minus to remove)</label><input id="adj-d" inputMode="numeric" autoFocus value={delta} onChange={(e) => setDelta(e.target.value)} placeholder="e.g. 10 or -2" /></div>
      <div className="field"><label htmlFor="adj-r">Reason (optional)</label><input id="adj-r" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="New delivery, damaged, stock count…" /></div>
    </Modal>
  );
}

function TransferModal({ locations, rows, onClose, onDone }: { locations: Loc[]; rows: Row[]; onClose: () => void; onDone: () => void }) {
  const [from, setFrom] = useState(locations[0]?.id ?? "");
  const [to, setTo] = useState(locations[1]?.id ?? "");
  const [lines, setLines] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
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
        <div className="field"><label>From</label><Select value={from} onChange={(e) => { setFrom(e.target.value); setLines({}); }}>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></div>
        <div className="field"><label>To</label><Select value={to} onChange={(e) => setTo(e.target.value)}>{locations.filter((l) => l.id !== from).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></div>
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
