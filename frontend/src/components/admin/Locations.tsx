"use client";

import { useState } from "react";
import { api, type Market } from "@/lib/api";
import { countryName, dialCodes } from "@/lib/countries";
import { maxLen, phone as phoneErr, postcode as postcodeErr, required } from "@/lib/validators";
import { FieldError, useValidation } from "./validation";
import { ArrowLeft, Plus } from "../Icons";
import { Switch } from "./Switch";
import { Select } from "../Select";
import { useApi } from "./hooks";

type Loc = { id?: string; name: string; company: string; line1: string; line2: string; city: string; region: string; postcode: string; country: string; phone: string; active: boolean; isDefault?: boolean; marketId?: string | null };
const blank = (country = ""): Loc => ({ name: "", company: "", line1: "", line2: "", city: "", region: "", postcode: "", country, phone: "", active: true });

function LocationEditor({ initial, countries, onDone }: { initial: Loc; countries: string[]; onDone: () => void }) {
  const [f, setF] = useState(initial);
  const { data: markets = [] } = useApi<Market[]>("/markets");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Loc, v: string | boolean | null) => setF((c) => ({ ...c, [k]: v }));
  const val = useValidation({
    name: required(f.name, "Enter a location name") || maxLen(f.name, 100, "The name"),
    line1: required(f.line1, "Enter a street address") || maxLen(f.line1, 200, "The address"),
    city: required(f.city, "Enter a city") || maxLen(f.city, 100, "The city"),
    region: maxLen(f.region, 60, "The region"),
    postcode: postcodeErr(f.postcode, f.country),
    country: f.country ? "" : "Choose a country",
    phone: phoneErr(f.phone),
  });
  const save = async () => {
    if (!val.submit()) return;
    setBusy(true); setErr("");
    try { await api(f.id ? `/locations/${f.id}` : "/locations", { method: f.id ? "PUT" : "POST", json: f }); onDone(); }
    catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  const remove = async () => {
    if (!f.id || !confirm(`Delete "${f.name}"?`)) return;
    try { await api(`/locations/${f.id}`, { method: "DELETE" }); onDone(); } catch (e) { setErr((e as Error).message); }
  };
  const text = (k: "name" | "company" | "line1" | "line2" | "city" | "region" | "postcode" | "phone", label: string, extra?: React.InputHTMLAttributes<HTMLInputElement>) => (
    <div className="field"><label htmlFor={`lc-${k}`}>{label}</label><input id={`lc-${k}`} value={f[k]} onChange={(e) => set(k, e.target.value)} {...extra} {...val.props(k)} /><FieldError k={k} msg={val.err(k)} /></div>
  );
  return (
    <>
      <div className="crumbbar"><button className="link crumb" onClick={onDone}><ArrowLeft />Locations</button></div>
      <div className="pagehead"><h2>{f.id ? f.name : "Add location"}</h2></div>
      {err && <div className="error">{err}</div>}
      <div className="card" style={{ maxWidth: 720 }}>
        {text("name", "Location name", { autoFocus: true, placeholder: "e.g. Toronto warehouse" })}
        <div className="field"><label>Market this location serves</label>
          <Select value={f.marketId ?? ""} onChange={(e) => set("marketId", e.target.value || null)}>
            <option value="">Automatic (the market that sells to its country)</option>
            {(markets ?? []).map((m) => <option key={m.id} value={m.id}>{m.name} ({m.currency})</option>)}
          </Select>
          <div className="muted">Its stock counts toward this market, and online orders from this market are picked from here.</div>
        </div>
        <div className="field"><label>Country</label>
          <Select value={f.country} onChange={(e) => set("country", e.target.value)} {...val.props("country")}>
            <option value="">Choose a country…</option>
            {countries.map((c) => <option key={c} value={c}>{countryName(c)}</option>)}
          </Select>
          <FieldError k="country" msg={val.err("country")} />
        </div>
        {text("company", "Company (optional)")}
        {text("line1", "Address")}
        {text("line2", "Apartment, suite, etc. (optional)")}
        <div className="row">{text("city", "City")}{text("region", "Province / state")}{text("postcode", "Postal code")}</div>
        {text("phone", "Phone (optional)")}
        {!f.isDefault && f.id && (
          <div className="cardhead" style={{ marginBottom: 0 }}><span><b>Active</b><div className="muted">Inactive locations are kept but not offered anywhere.</div></span><Switch checked={f.active} onChange={(v) => set("active", v)} label="Active" /></div>
        )}
      </div>
      <div className="savebar">
        {f.id && !f.isDefault && <button className="danger" onClick={remove}>Delete location</button>}
        <span style={{ flex: 1 }} />
        <button onClick={onDone}>Discard</button>
        <button className="primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>
      </div>
    </>
  );
}

export function Locations() {
  const { data: locs, error, reload } = useApi<Loc[]>("/locations");
  const { data: markets } = useApi<Market[]>("/markets");
  const [edit, setEdit] = useState<Loc | null>(null);
  const [err, setErr] = useState("");
  const countries = [...new Set([...(markets ?? []).flatMap((m) => m.countries), ...dialCodes.map((d) => d.code as string)])];
  const makeDefault = async (id: string) => { try { await api(`/locations/${id}/default`, { method: "POST" }); reload(); } catch (e) { setErr((e as Error).message); } };

  if (edit) return <LocationEditor key={edit.id ?? "new"} initial={edit} countries={countries} onDone={() => { setEdit(null); reload(); }} />;
  const active = (locs ?? []).filter((l) => l.active).length;
  return (
    <>
      <div className="pagehead">
        <div><h2>Locations</h2><div className="muted">Places you ship from. The default location is the sender on shipping labels and packing slips.</div></div>
        <div className="headtools"><button className="primary" onClick={() => setEdit(blank(countries[0] ?? ""))}><Plus />Add location</button></div>
      </div>
      {(error || err) && <div className="error">{error || err}</div>}
      <div className="card">
        <h3>All locations</h3>
        <p className="muted" style={{ marginTop: -4 }}>{active} active location{active === 1 ? "" : "s"}</p>
        <div className="tablescroll">
          <table>
            <thead><tr><th>Location</th><th>Status</th><th /></tr></thead>
            <tbody>
              {locs?.map((l) => (
                <tr key={l.id} className="clickable" onClick={() => setEdit(l)}>
                  <td><b>{l.name}</b><div className="muted">{[l.line1, l.city, l.region, countryName(l.country)].filter(Boolean).join(", ")}</div></td>
                  <td>{l.isDefault && <span className="badge ok">Default</span>} <span className={`badge ${l.active ? "ok" : ""}`}>{l.active ? "Active" : "Inactive"}</span></td>
                  <td style={{ textAlign: "right" }} onClick={(e) => e.stopPropagation()}>{!l.isDefault && <button className="link" onClick={() => makeDefault(l.id!)}>Make default</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {locs && !locs.length && <p className="muted">No locations yet. Add the address you ship from.</p>}
        <p className="muted" style={{ marginBottom: 0 }}>Stock counts are still kept per product, not per location.</p>
      </div>
    </>
  );
}
