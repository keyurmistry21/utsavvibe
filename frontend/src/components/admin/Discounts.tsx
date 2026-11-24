"use client";

import { useState } from "react";
import { api, money, toMajor, toMinor } from "@/lib/api";
import { useApi } from "./hooks";
import { Modal } from "./Modal";
import { Select } from "../Select";

type Code = { id: string; code: string; kind: "percent" | "fixed" | "free_shipping" | "buy_x_get_y"; buyQty: number; getQty: number; getPercent: number; productId: string | null; value: number; currency: string | null; minSubtotal: number; startsAt: string | null; endsAt: string | null; usageLimit: number | null; usedCount: number; active: boolean; note: string };
type Form = { buyQty: string; getQty: string; getPercent: string; productId: string; id?: string; code: string; kind: Code["kind"]; value: string; currency: string; minSubtotal: string; startsAt: string; endsAt: string; usageLimit: string; active: boolean; note: string };
const blank: Form = { buyQty: "2", getQty: "1", getPercent: "100", productId: "", code: "", kind: "percent", value: "10", currency: "GBP", minSubtotal: "", startsAt: "", endsAt: "", usageLimit: "", active: true, note: "" };
const CURRENCIES = ["GBP", "USD", "CAD"];

const describe = (c: Code) => (c.kind === "buy_x_get_y" ? `Buy ${c.buyQty}, get ${c.getQty}${c.getPercent >= 100 ? " free" : ` at ${c.getPercent}% off`}` : c.kind === "percent" ? `${c.value}% off` : c.kind === "fixed" ? `${money(c.value, c.currency ?? "GBP")} off` : "Free shipping");
const state = (c: Code) => {
  const now = Date.now();
  if (!c.active) return ["Off", ""] as const;
  if (c.endsAt && new Date(c.endsAt).getTime() < now) return ["Expired", "bad"] as const;
  if (c.startsAt && new Date(c.startsAt).getTime() > now) return ["Scheduled", "warn"] as const;
  if (c.usageLimit != null && c.usedCount >= c.usageLimit) return ["Used up", "warn"] as const;
  return ["Active", "good"] as const;
};
const dayInput = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

export function Discounts() {
  const { data, error, reload } = useApi<Code[]>("/discounts");
  const [edit, setEdit] = useState<Form | null>(null);

  return (
    <>
      <div className="pagehead">
        <div><h2>Discount codes</h2><div className="muted">Customers type a code in the cart. Percent off, an amount off, or free shipping.</div></div>
        <button className="primary" onClick={() => setEdit({ ...blank })}>Create code</button>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="card">
        <table>
          <thead><tr><th>Code</th><th>Discount</th><th>Minimum spend</th><th>Used</th><th>Dates</th><th>Status</th><th /></tr></thead>
          <tbody>
            {data?.map((c) => {
              const [label, tone] = state(c);
              return (
                <tr key={c.id}>
                  <td><b style={{ fontFamily: "ui-monospace, Menlo, monospace" }}>{c.code}</b>{c.note && <div className="muted">{c.note}</div>}</td>
                  <td>{describe(c)}</td>
                  <td>{c.minSubtotal ? money(c.minSubtotal, c.currency ?? "GBP") : "None"}</td>
                  <td>{c.usedCount}{c.usageLimit != null ? ` / ${c.usageLimit}` : ""}</td>
                  <td className="muted">{c.startsAt || c.endsAt ? `${c.startsAt ? new Date(c.startsAt).toLocaleDateString() : "Now"} to ${c.endsAt ? new Date(c.endsAt).toLocaleDateString() : "no end"}` : "Always"}</td>
                  <td><span className={`badge ${tone}`}>{label}</span></td>
                  <td className="r"><button className="link" onClick={() => setEdit({ buyQty: String(c.buyQty || 2), getQty: String(c.getQty || 1), getPercent: String(c.getPercent || 100), productId: c.productId ?? "", id: c.id, code: c.code, kind: c.kind, value: c.kind === "percent" ? String(c.value) : toMajor(c.value), currency: c.currency ?? "GBP", minSubtotal: c.minSubtotal ? toMajor(c.minSubtotal) : "", startsAt: dayInput(c.startsAt), endsAt: dayInput(c.endsAt), usageLimit: c.usageLimit != null ? String(c.usageLimit) : "", active: c.active, note: c.note })}>Edit</button></td>
                </tr>
              );
            })}
            {data && !data.length && <tr><td colSpan={7}>No discount codes yet. Create one for Diwali, a first order, or free shipping.</td></tr>}
          </tbody>
        </table>
      </div>
      {edit && <Editor f={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </>
  );
}

function Editor({ f: init, onClose, onSaved }: { f: Form; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState(init);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const { data: prodList } = useApi<{ items: { id: string; title: string }[] }>("/products/list?limit=100");
  const prods = prodList?.items;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((c) => ({ ...c, [k]: v }));

  const body = () => ({
    code: f.code, kind: f.kind, buyQty: parseInt(f.buyQty || "0"), getQty: parseInt(f.getQty || "0"), getPercent: parseInt(f.getPercent || "100"), productId: f.productId || null,
    value: f.kind === "percent" ? parseInt(f.value || "0") : f.kind === "fixed" ? toMinor(f.value) : 0,
    currency: f.kind === "fixed" ? f.currency : null,
    minSubtotal: f.minSubtotal ? toMinor(f.minSubtotal) : 0,
    startsAt: f.startsAt ? new Date(`${f.startsAt}T00:00:00`).toISOString() : null,
    endsAt: f.endsAt ? new Date(`${f.endsAt}T23:59:59`).toISOString() : null,
    usageLimit: f.usageLimit ? parseInt(f.usageLimit) : null,
    active: f.active, note: f.note,
  });
  const save = async () => {
    setBusy(true); setErr("");
    try { await api(f.id ? `/discounts/${f.id}` : "/discounts", { method: f.id ? "PUT" : "POST", json: body() }); onSaved(); }
    catch (e) { setErr((e as Error).message === "validation" ? "Check the code, the amount and the dates." : (e as Error).message); }
    setBusy(false);
  };
  const remove = async () => {
    if (!f.id || !confirm("Delete this code?")) return;
    try { await api(`/discounts/${f.id}`, { method: "DELETE" }); onSaved(); } catch (e) { setErr((e as Error).message); }
  };

  return (
    <Modal title={f.id ? "Edit discount code" : "Create discount code"} onClose={onClose} dismissOnScrim={false}
      footer={<><span>{f.id && <button onClick={remove}>Delete</button>}</span><span style={{ display: "flex", gap: 8 }}><button onClick={onClose}>Cancel</button><button className="primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button></span></>}>
      {err && <div className="error">{err}</div>}
      <div className="field"><label htmlFor="dc-code">Code</label><input id="dc-code" autoFocus value={f.code} onChange={(e) => set("code", e.target.value.toUpperCase())} placeholder="DIWALI10" /></div>
      <div className="row">
        <div className="field"><label>Type</label><Select value={f.kind} onChange={(e) => set("kind", e.target.value as Form["kind"])}><option value="percent">Percent off</option><option value="fixed">Amount off</option><option value="free_shipping">Free shipping</option><option value="buy_x_get_y">Buy X, get Y</option></Select></div>
        {f.kind === "percent" && <div className="field"><label htmlFor="dc-val">Percent</label><input id="dc-val" inputMode="numeric" value={f.value} onChange={(e) => set("value", e.target.value)} /></div>}
        {f.kind === "buy_x_get_y" && <>
          <div className="field"><label htmlFor="dc-bx">Buy</label><input id="dc-bx" inputMode="numeric" value={f.buyQty} onChange={(e) => set("buyQty", e.target.value)} /></div>
          <div className="field"><label htmlFor="dc-gy">Get</label><input id="dc-gy" inputMode="numeric" value={f.getQty} onChange={(e) => set("getQty", e.target.value)} /></div>
          <div className="field"><label htmlFor="dc-gp">% off those</label><input id="dc-gp" inputMode="numeric" value={f.getPercent} onChange={(e) => set("getPercent", e.target.value)} /></div>
        </>}
        {f.kind === "fixed" && <><div className="field"><label htmlFor="dc-val">Amount</label><input id="dc-val" inputMode="decimal" value={f.value} onChange={(e) => set("value", e.target.value)} /></div><div className="field"><label>Currency</label><Select value={f.currency} onChange={(e) => set("currency", e.target.value)}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select></div></>}
      </div>
      {f.kind === "buy_x_get_y" && <div className="field"><label>Applies to</label><Select value={f.productId} onChange={(e) => set("productId", e.target.value)}><option value="">Any product (cheapest items are discounted)</option>{(prods ?? []).map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</Select></div>}
      <div className="row">
        <div className="field"><label htmlFor="dc-min">Minimum spend (optional)</label><input id="dc-min" inputMode="decimal" value={f.minSubtotal} onChange={(e) => set("minSubtotal", e.target.value)} /></div>
        <div className="field"><label htmlFor="dc-lim">Total uses (optional)</label><input id="dc-lim" inputMode="numeric" value={f.usageLimit} onChange={(e) => set("usageLimit", e.target.value)} placeholder="Unlimited" /></div>
      </div>
      <div className="row">
        <div className="field"><label htmlFor="dc-s">Starts (optional)</label><input id="dc-s" type="date" value={f.startsAt} onChange={(e) => set("startsAt", e.target.value)} /></div>
        <div className="field"><label htmlFor="dc-e">Ends (optional)</label><input id="dc-e" type="date" value={f.endsAt} onChange={(e) => set("endsAt", e.target.value)} /></div>
      </div>
      <div className="field"><label htmlFor="dc-note">Internal note (optional)</label><input id="dc-note" value={f.note} onChange={(e) => set("note", e.target.value)} /></div>
      <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => set("active", e.target.checked)} /> Code is active</label>
    </Modal>
  );
}
