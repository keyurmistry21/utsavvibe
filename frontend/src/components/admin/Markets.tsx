"use client";

import { useEffect, useState } from "react";
import { api, toMajor, toMinor, type Market, type Region, type ShippingRate } from "@/lib/api";
import { useApi } from "./hooks";
import { Plus } from "../Icons";

type Draft = Omit<Market, "id" | "shippingRates"> & { id?: string; shippingRates: ShippingRate[] };

const blankMarket = (): Draft => ({
  code: "", name: "", currency: "USD", countries: [], regions: [], taxRateBps: 0, taxInclusive: false, active: true,
  shippingRates: [{ name: "Standard", amount: 0, freeOverAmount: null, minDays: null, maxDays: null }],
});

function MarketEditor({ initial, onDone }: { initial: Draft; onDone: () => void }) {
  const [m, setM] = useState(initial);
  const [err, setErr] = useState("");
  const setRegion = (i: number, patch: Partial<Region>) => setM({ ...m, regions: m.regions.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const setRate = (i: number, patch: Partial<ShippingRate>) => setM({ ...m, shippingRates: m.shippingRates.map((r, j) => (j === i ? { ...r, ...patch } : r)) });

  const save = async () => {
    setErr("");
    try {
      const { id, ...body } = m;
      body.shippingRates = body.shippingRates.map(({ id: _i, ...r }) => r) as ShippingRate[];
      await api(id ? `/markets/${id}` : "/markets", { method: id ? "PUT" : "POST", json: body });
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div className="card">
      <div className="row">
        <div className="field"><label>Code</label><input value={m.code} disabled={!!m.id} onChange={(e) => setM({ ...m, code: e.target.value.toUpperCase() })} /></div>
        <div className="field"><label>Name</label><input value={m.name} onChange={(e) => setM({ ...m, name: e.target.value })} /></div>
        <div className="field"><label>Currency</label><input maxLength={3} value={m.currency} onChange={(e) => setM({ ...m, currency: e.target.value.toUpperCase() })} /></div>
        <div className="field"><label>Countries (ISO, comma)</label><input value={m.countries.join(",")} onChange={(e) => setM({ ...m, countries: e.target.value.split(",").map((c) => c.trim().toUpperCase()).filter(Boolean) })} /></div>
      </div>
      <div className="row">
        <div className="field"><label>Tax rate %</label><input type="number" step="0.01" value={m.taxRateBps / 100} onChange={(e) => setM({ ...m, taxRateBps: Math.round(parseFloat(e.target.value || "0") * 100) })} /></div>
        <div className="checks field"><label><input type="checkbox" checked={m.taxInclusive} onChange={(e) => setM({ ...m, taxInclusive: e.target.checked })} />Prices include tax</label></div>
        <div className="checks field"><label><input type="checkbox" checked={m.active} onChange={(e) => setM({ ...m, active: e.target.checked })} />Active</label></div>
      </div>
      <h4>Provinces / states (tax by region)</h4>
      <p className="muted">Optional. When set, customers choose a region at checkout and its rate replaces the market tax rate above.</p>
      {m.regions.map((r, i) => (
        <div key={i} className="row">
          <div className="field"><label>Code</label><input value={r.code} maxLength={8} onChange={(e) => setRegion(i, { code: e.target.value.toUpperCase() })} /></div>
          <div className="field"><label>Name</label><input value={r.name} onChange={(e) => setRegion(i, { name: e.target.value })} /></div>
          <div className="field"><label>Total tax %</label><input type="number" step="0.001" value={r.taxRateBps / 100} onChange={(e) => setRegion(i, { taxRateBps: Math.round(parseFloat(e.target.value || "0") * 100) })} /></div>
          <div className="field" style={{ flex: "none", minWidth: 0 }}><button className="link" onClick={() => setM({ ...m, regions: m.regions.filter((_, j) => j !== i) })}>Remove</button></div>
        </div>
      ))}
      <button onClick={() => setM({ ...m, regions: [...m.regions, { code: "", name: "", taxRateBps: 0 }] })}><Plus />Add region</button>
      <h4>Shipping rates</h4>
      {m.shippingRates.map((r, i) => (
        <div key={i} className="row">
          <div className="field"><label>Name</label><input value={r.name} onChange={(e) => setRate(i, { name: e.target.value })} /></div>
          <div className="field"><label>Price ({m.currency})</label><input type="number" step="0.01" value={toMajor(r.amount)} onChange={(e) => setRate(i, { amount: toMinor(e.target.value) })} /></div>
          <div className="field"><label>Free over</label><input type="number" step="0.01" value={toMajor(r.freeOverAmount ?? undefined)} onChange={(e) => setRate(i, { freeOverAmount: e.target.value ? toMinor(e.target.value) : null })} /></div>
          <div className="field"><label>Min days</label><input type="number" value={r.minDays ?? ""} onChange={(e) => setRate(i, { minDays: e.target.value ? +e.target.value : null })} /></div>
          <div className="field"><label>Max days</label><input type="number" value={r.maxDays ?? ""} onChange={(e) => setRate(i, { maxDays: e.target.value ? +e.target.value : null })} /></div>
        </div>
      ))}
      <button onClick={() => setM({ ...m, shippingRates: [...m.shippingRates, { name: "", amount: 0, freeOverAmount: null, minDays: null, maxDays: null }] })}><Plus />Add rate</button>
      {err && <div className="error">{err}</div>}
      <p><button className="primary" onClick={save}>Save market</button> <button onClick={onDone}>Cancel</button></p>
    </div>
  );
}

export function Markets() {
  const { data, error, reload } = useApi<Market[]>("/markets");
  const [editing, setEditing] = useState<Draft | null>(null);
  useEffect(() => {
    if (new URLSearchParams(location.search).get("new")) {
      history.replaceState(null, "", location.pathname);
      setEditing(blankMarket());
    }
  }, []);
  const done = () => { setEditing(null); reload(); };

  return (
    <>
      <div className="pagehead">
        <h2>Markets</h2>
        <button className="primary" onClick={() => setEditing(blankMarket())}>Add market</button>
      </div>
      <p className="muted">Each market has its own currency, tax and shipping. Add a new location here when you expand.</p>
      {error && <div className="error">{error}</div>}
      {editing && <MarketEditor key={editing.id ?? "new"} initial={editing} onDone={done} />}
      {data?.map((m) => (
        <div key={m.id} className="card">
          <b>{m.name}</b> ({m.code}) · {m.currency} · {m.taxRateBps / 100}% {m.taxInclusive ? "incl." : "excl."} tax · {m.active ? "active" : "inactive"}{" "}
          <button className="link" onClick={() => setEditing(m)}>Edit</button>
          <div className="muted">{m.shippingRates.map((r) => `${r.name} ${toMajor(r.amount)}`).join(" · ")}</div>
        </div>
      ))}
    </>
  );
}
