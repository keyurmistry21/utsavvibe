"use client";

import { useEffect, useState } from "react";
import { api, toMajor, toMinor, type Market, type Region, type ShippingRate } from "@/lib/api";
import { useApi } from "./hooks";
import { Banner } from "./Banner";
import { useDirty, useUnsavedGuard } from "./unsaved";
import { FieldError, useValidation } from "./validation";
import { Plus } from "../Icons";
import { required } from "@/lib/validators";

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

  const E: Record<string, string> = {
    code: !m.code.trim() ? "Enter a market code, like UK" : !/^[A-Z0-9]{2,6}$/.test(m.code) ? "Use 2 to 6 letters or digits" : "",
    name: required(m.name, "Enter a market name"),
    currency: /^[A-Z]{3}$/.test(m.currency) ? "" : "Use a 3-letter currency code, like GBP",
    countries: !m.countries.length ? "Add at least one country code, like GB" : m.countries.some((c) => !/^[A-Z]{2}$/.test(c)) ? "Use 2-letter country codes separated by commas" : "",
    tax: m.taxRateBps < 0 || m.taxRateBps > 10000 ? "Tax rate must be between 0 and 100" : "",
  };
  m.regions.forEach((r, i) => {
    E[`rc${i}`] = !r.code.trim() ? "Enter a code" : m.regions.some((o, j) => j < i && o.code === r.code) ? "Duplicate code" : "";
    E[`rn${i}`] = required(r.name, "Enter a name");
    E[`rt${i}`] = r.taxRateBps < 0 || r.taxRateBps > 10000 ? "Between 0 and 100" : "";
    E[`rp${i}`] = r.components?.length && r.components.reduce((a, c) => a + c.bps, 0) !== r.taxRateBps ? "Parts must add up to the total" : "";
  });
  m.shippingRates.forEach((r, i) => {
    E[`sn${i}`] = required(r.name, "Enter a rate name");
    E[`sa${i}`] = r.amount < 0 ? "Can't be negative" : "";
    E[`sf${i}`] = r.freeOverAmount != null && r.freeOverAmount < 0 ? "Can't be negative" : "";
    E[`sm${i}`] = r.minDays != null && (r.minDays < 0 || r.minDays > 365) ? "0 to 365" : "";
    E[`sx${i}`] = r.maxDays != null && (r.maxDays < 0 || r.maxDays > 365 || (r.minDays != null && r.maxDays < r.minDays)) ? "Must be at least min days" : "";
  });
  if (!m.shippingRates.length) E.rates = "Add at least one shipping rate";
  const val = useValidation(E);
  const f = (k: string, label: string, ctl: React.ReactNode) => (
    <div className="field"><label htmlFor={`mk-${k}`}>{label}</label>{ctl}<FieldError k={k} msg={val.err(k)} small /></div>
  );

  const { dirty } = useDirty(m);
  const save = async (): Promise<boolean> => {
    if (!val.submit()) return false;
    setErr("");
    try {
      const { id, ...body } = m;
      body.shippingRates = body.shippingRates.map(({ id: _i, ...r }) => r) as ShippingRate[];
      await api(id ? `/markets/${id}` : "/markets", { method: id ? "PUT" : "POST", json: body });
      allow();
      onDone();
      return true;
    } catch (e) {
      setErr((e as Error).message);
      return false;
    }
  };
  const { guard, allow } = useUnsavedGuard(dirty, save);
  const cancel = () => { if (dirty && !confirm("Discard your changes?")) return; allow(); onDone(); };

  return (
    <div className="card">
      {guard}
      <div className="row">
        {f("code", "Code", <input id="mk-code" value={m.code} disabled={!!m.id} onChange={(e) => setM({ ...m, code: e.target.value.toUpperCase() })} {...val.props("code")} />)}
        {f("name", "Name", <input id="mk-name" value={m.name} onChange={(e) => setM({ ...m, name: e.target.value })} {...val.props("name")} />)}
        {f("currency", "Currency", <input id="mk-currency" maxLength={3} value={m.currency} onChange={(e) => setM({ ...m, currency: e.target.value.toUpperCase() })} {...val.props("currency")} />)}
        {f("countries", "Countries (ISO, comma)", <input id="mk-countries" value={m.countries.join(",")} onChange={(e) => setM({ ...m, countries: e.target.value.split(",").map((c) => c.trim().toUpperCase()).filter(Boolean) })} {...val.props("countries")} />)}
      </div>
      <div className="row">
        {f("tax", "Tax rate %", <input id="mk-tax" type="number" step="0.01" value={m.taxRateBps / 100} onChange={(e) => setM({ ...m, taxRateBps: Math.round(parseFloat(e.target.value || "0") * 100) })} {...val.props("tax")} />)}
        <div className="checks field"><label><input type="checkbox" checked={m.taxInclusive} onChange={(e) => setM({ ...m, taxInclusive: e.target.checked })} />Prices include tax</label></div>
        <div className="checks field"><label><input type="checkbox" checked={m.active} onChange={(e) => setM({ ...m, active: e.target.checked })} />Active</label></div>
      </div>
      <h4>Provinces / states (tax by region)</h4>
      <p className="muted">Optional. When set, customers choose a region at checkout and its rate replaces the market tax rate above.</p>
      {m.regions.map((r, i) => (
        <div key={i} className="row">
          {f(`rc${i}`, "Code", <input id={`mk-rc${i}`} value={r.code} maxLength={8} onChange={(e) => setRegion(i, { code: e.target.value.toUpperCase() })} {...val.props(`rc${i}`)} />)}
          {f(`rn${i}`, "Name", <input id={`mk-rn${i}`} value={r.name} onChange={(e) => setRegion(i, { name: e.target.value })} {...val.props(`rn${i}`)} />)}
          {f(`rt${i}`, "Total tax %", <input id={`mk-rt${i}`} type="number" step="0.001" value={r.taxRateBps / 100} onChange={(e) => setRegion(i, { taxRateBps: Math.round(parseFloat(e.target.value || "0") * 100) })} {...val.props(`rt${i}`)} />)}
          {f(`rp${i}`, "Parts (optional)", <input id={`mk-rp${i}`} placeholder="GST 5 + PST 7" defaultValue={(r.components ?? []).map((c) => `${c.name} ${c.bps / 100}`).join(" + ")} onChange={(e) => setRegion(i, { components: parseParts(e.target.value) })} {...val.props(`rp${i}`)} />)}
          <div className="field" style={{ flex: "none", minWidth: 0 }}><button className="link" onClick={() => setM({ ...m, regions: m.regions.filter((_, j) => j !== i) })}>Remove</button></div>
        </div>
      ))}
      <button onClick={() => setM({ ...m, regions: [...m.regions, { code: "", name: "", taxRateBps: 0 }] })}><Plus />Add region</button>
      {m.countries.includes("US") && !m.regions.length && (
        <button title="Lets you limit a product to certain states, and set sales tax per state" onClick={() => setM({ ...m, regions: US_STATES.map(([code, name]) => ({ code, name, taxRateBps: 0 })) })}>Add all 50 states + DC (tax 0%, edit per state)</button>
      )}
      {m.countries.includes("CA") && !m.regions.length && (
        <button onClick={() => setM({ ...m, regions: CA_PROVINCES.map(([code, name, taxRateBps]) => ({ code, name, taxRateBps: taxRateBps as number })) })}>Add all provinces (standard GST/HST/PST rates)</button>
      )}
      <h4>Shipping rates</h4>
      {m.shippingRates.map((r, i) => (
        <div key={i} className="row">
          {f(`sn${i}`, "Name", <input id={`mk-sn${i}`} value={r.name} onChange={(e) => setRate(i, { name: e.target.value })} {...val.props(`sn${i}`)} />)}
          {f(`sa${i}`, `Price (${m.currency})`, <input id={`mk-sa${i}`} type="number" step="0.01" value={toMajor(r.amount)} onChange={(e) => setRate(i, { amount: toMinor(e.target.value) })} {...val.props(`sa${i}`)} />)}
          {f(`sf${i}`, "Free over", <input id={`mk-sf${i}`} type="number" step="0.01" value={toMajor(r.freeOverAmount ?? undefined)} onChange={(e) => setRate(i, { freeOverAmount: e.target.value ? toMinor(e.target.value) : null })} {...val.props(`sf${i}`)} />)}
          {f(`sm${i}`, "Min days", <input id={`mk-sm${i}`} type="number" value={r.minDays ?? ""} onChange={(e) => setRate(i, { minDays: e.target.value ? +e.target.value : null })} {...val.props(`sm${i}`)} />)}
          {f(`sx${i}`, "Max days", <input id={`mk-sx${i}`} type="number" value={r.maxDays ?? ""} onChange={(e) => setRate(i, { maxDays: e.target.value ? +e.target.value : null })} {...val.props(`sx${i}`)} />)}
        </div>
      ))}
      <button onClick={() => setM({ ...m, shippingRates: [...m.shippingRates, { name: "", amount: 0, freeOverAmount: null, minDays: null, maxDays: null }] })}><Plus />Add rate</button>
      <FieldError k="rates" msg={val.err("rates")} />
      {err && <div className="error">{err}</div>}
      <p><button className="primary" onClick={save}>Save market</button> <button onClick={cancel}>Cancel</button></p>
    </div>
  );
}

const US_STATES: [string, string][] = [["AL","Alabama"],["AK","Alaska"],["AZ","Arizona"],["AR","Arkansas"],["CA","California"],["CO","Colorado"],["CT","Connecticut"],["DE","Delaware"],["DC","District of Columbia"],["FL","Florida"],["GA","Georgia"],["HI","Hawaii"],["ID","Idaho"],["IL","Illinois"],["IN","Indiana"],["IA","Iowa"],["KS","Kansas"],["KY","Kentucky"],["LA","Louisiana"],["ME","Maine"],["MD","Maryland"],["MA","Massachusetts"],["MI","Michigan"],["MN","Minnesota"],["MS","Mississippi"],["MO","Missouri"],["MT","Montana"],["NE","Nebraska"],["NV","Nevada"],["NH","New Hampshire"],["NJ","New Jersey"],["NM","New Mexico"],["NY","New York"],["NC","North Carolina"],["ND","North Dakota"],["OH","Ohio"],["OK","Oklahoma"],["OR","Oregon"],["PA","Pennsylvania"],["RI","Rhode Island"],["SC","South Carolina"],["SD","South Dakota"],["TN","Tennessee"],["TX","Texas"],["UT","Utah"],["VT","Vermont"],["VA","Virginia"],["WA","Washington"],["WV","West Virginia"],["WI","Wisconsin"],["WY","Wyoming"]];
const CA_PROVINCES: [string, string, number][] = [["AB","Alberta",500],["BC","British Columbia",1200],["MB","Manitoba",1200],["NB","New Brunswick",1500],["NL","Newfoundland and Labrador",1500],["NS","Nova Scotia",1500],["NT","Northwest Territories",500],["NU","Nunavut",500],["ON","Ontario",1300],["PE","Prince Edward Island",1500],["QC","Quebec",1498],["SK","Saskatchewan",1100],["YT","Yukon",500]];

// "GST 5 + PST 7" -> [{name: GST, bps: 500}, {name: PST, bps: 700}]; empty = no split
const parseParts = (t: string) => { const out = t.split(/[+,]/).map((x) => x.trim().match(/^([A-Za-z]{2,10})\s+([\d.]+)%?$/)).filter(Boolean).map((m) => ({ name: m![1].toUpperCase(), bps: Math.round(parseFloat(m![2]) * 100) })); return out.length ? out : null; };

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

  const list = data ?? [];
  const activeN = list.filter((m) => m.active).length;
  const curs = [...new Set(list.map((m) => m.currency))];
  const regionsN = list.reduce((a, m) => a + (m.regions?.length ?? 0), 0);
  const hue = (t: string) => [...t].reduce((a, c) => a + c.charCodeAt(0) * 11, 0) % 360;

  return (
    <>
      <div className="pagehead">
        <h2>Markets</h2>
        <button className="primary" onClick={() => setEditing(blankMarket())}>Add market</button>
      </div>
      {error && <div className="error">{error}</div>}
      {editing && <MarketEditor key={editing.id ?? "new"} initial={editing} onDone={done} />}
      {!editing && (
        <>
          <Banner title="Markets summary" ring={{ value: list.length, label: "markets", segs: [{ cls: "ok", n: activeN }, { cls: "arch", n: list.length - activeN }] }} stats={[
            { label: "Selling now", value: activeN, tone: "ok" },
            { label: curs.length ? `Currencies · ${curs.join(", ")}` : "Currencies", value: curs.length, tone: "low" },
            { label: "States and provinces", value: regionsN, tone: "arch" },
          ]}>
            <span className="bn-note">Each market has its own currency, tax and shipping. Add a new one here when you expand.</span>
          </Banner>
          <div className="xr-list">
            {list.map((m) => (
              <button key={m.id} className={`xr ${m.active ? "" : "arch"}`} onClick={() => setEditing(m)} aria-label={`Edit ${m.name}`} style={{ ["--cols" as string]: "52px minmax(0,1.3fr) minmax(0,1fr) minmax(0,1.3fr) auto 18px" }}>
                <span className="xr-av" style={{ background: `linear-gradient(135deg,hsl(${hue(m.code)} 75% 55%),hsl(${(hue(m.code) + 40) % 360} 70% 40%))` }}>{m.code}</span>
                <span className="xr-main"><b>{m.name}</b><small>{(m.countries ?? []).join(", ") || "No countries"} · {m.regions?.length ? `${m.regions.length} states or provinces` : "no regions"}</small></span>
                <span className="xr-main hide-s"><b>{m.currency}</b><small>{m.taxRateBps / 100}% tax {m.taxInclusive ? "included" : "added at checkout"}</small></span>
                <span className="xr-main hide-s"><b>Shipping</b><small>{m.shippingRates.map((r) => `${r.name} ${toMajor(r.amount)}`).join(" · ") || "No rates"}</small></span>
                <span className={`badge ${m.active ? "good" : ""}`}>{m.active ? "Active" : "Inactive"}</span>
                <svg className="iv-go" viewBox="0 0 24 24" aria-hidden><path d="M9 6l6 6-6 6" /></svg>
              </button>
            ))}
            {data && !list.length && <div className="xr-empty"><div aria-hidden>🌍</div><b>No markets yet</b><span>Add your first market to start selling.</span></div>}
          </div>
        </>
      )}
    </>
  );
}
