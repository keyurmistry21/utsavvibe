"use client";

import { useState } from "react";
import { blankAddress, type Address, type Market } from "@/lib/api";
import { countryName } from "@/lib/countries";
import { Modal } from "./Modal";
import { PhoneInput } from "./PhoneInput";

export function AddressModal({ title, initial, markets, onSave, onClose }: {
  title: string;
  initial: Address | null;
  markets: Market[];
  onSave: (a: Address) => void;
  onClose: () => void;
}) {
  const countries = Array.from(new Set(markets.flatMap((m) => m.countries)));
  const [a, setA] = useState<Address>(() => {
    const start = { ...blankAddress(), ...(initial ?? {}) };
    return { ...start, country: start.country || countries[0] || "" }; // empty country falls back to the first market's
  });
  const set = (k: keyof Address) => (e: React.ChangeEvent<HTMLInputElement>) => setA({ ...a, [k]: e.target.value });
  const regions = markets.find((m) => m.countries.includes(a.country))?.regions ?? [];
  const stateLabel = a.country === "US" ? "State" : "Province";

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <span />
          <span style={{ display: "flex", gap: 8 }}>
            <button onClick={onClose}>Cancel</button>
            <button className="primary" onClick={() => onSave(a)}>Save</button>
          </span>
        </>
      }
    >
      <div className="field"><label>Country/region</label>
        <select value={a.country} onChange={(e) => setA({ ...a, country: e.target.value, region: "" })}>
          {countries.map((c) => <option key={c} value={c}>{countryName(c)}</option>)}
        </select>
      </div>
      <div className="row">
        <div className="field"><label>First name</label><input value={a.firstName} onChange={set("firstName")} autoComplete="given-name" /></div>
        <div className="field"><label>Last name</label><input value={a.lastName} onChange={set("lastName")} autoComplete="family-name" /></div>
      </div>
      <div className="field"><label>Company</label><input value={a.company} onChange={set("company")} /></div>
      <div className="field"><label>Address</label><input value={a.line1} onChange={set("line1")} autoComplete="address-line1" /></div>
      <div className="field"><label>Apartment, suite, etc</label><input value={a.line2} onChange={set("line2")} autoComplete="address-line2" /></div>
      <div className="row">
        <div className="field"><label>City</label><input value={a.city} onChange={set("city")} autoComplete="address-level2" /></div>
        {regions.length ? (
          <div className="field"><label>{stateLabel}</label>
            <select value={a.region} onChange={(e) => setA({ ...a, region: e.target.value })}>
              <option value="">Select a {stateLabel.toLowerCase()}</option>
              {regions.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
            </select>
          </div>
        ) : (
          <div className="field"><label>Region</label><input value={a.region} onChange={set("region")} /></div>
        )}
        <div className="field"><label>{a.country === "US" ? "ZIP code" : "Postal code"}</label><input value={a.postcode} onChange={set("postcode")} autoComplete="postal-code" /></div>
      </div>
      <div className="field"><label>Phone</label><PhoneInput value={a.phone} onChange={(v) => setA({ ...a, phone: v })} defaultCountry={a.country === "GB" ? "GB" : a.country === "US" ? "US" : "CA"} /></div>
    </Modal>
  );
}
