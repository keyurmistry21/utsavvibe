"use client";

import { useState } from "react";
import { blankAddress, type Address, type Market } from "@/lib/api";
import { countryName } from "@/lib/countries";
import { maxLen, phone as phoneErr, postcode as postcodeErr, required } from "@/lib/validators";
import { FieldError, useValidation } from "./validation";
import { Modal } from "./Modal";
import { PhoneInput } from "./PhoneInput";
import { Select } from "../Select";

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
  const E: Record<string, string> = {
    line1: required(a.line1, "Enter the street address") || maxLen(a.line1, 190, "The address"),
    city: required(a.city, "Enter the city") || maxLen(a.city, 120, "The city"),
    region: regions.length ? required(a.region, `Select a ${stateLabel.toLowerCase()}`) : maxLen(a.region, 40, "The region"),
    postcode: postcodeErr(a.postcode, a.country),
    phone: phoneErr(a.phone),
    firstName: maxLen(a.firstName, 100, "First name"), lastName: maxLen(a.lastName, 100, "Last name"), company: maxLen(a.company, 190, "Company"),
  };
  const val = useValidation(E);

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <span />
          <span style={{ display: "flex", gap: 8 }}>
            <button onClick={onClose}>Cancel</button>
            <button className="primary" onClick={() => { if (val.submit()) onSave(a); }}>Save</button>
          </span>
        </>
      }
    >
      <div className="field"><label>Country/region</label>
        <Select value={a.country} onChange={(e) => setA({ ...a, country: e.target.value, region: "" })}>
          {countries.map((c) => <option key={c} value={c}>{countryName(c)}</option>)}
        </Select>
      </div>
      <div className="row">
        <div className="field"><label>First name</label><input value={a.firstName} onChange={set("firstName")} autoComplete="given-name" {...val.props("firstName")} /><FieldError k="firstName" msg={val.err("firstName")} /></div>
        <div className="field"><label>Last name</label><input value={a.lastName} onChange={set("lastName")} autoComplete="family-name" {...val.props("lastName")} /><FieldError k="lastName" msg={val.err("lastName")} /></div>
      </div>
      <div className="field"><label>Company</label><input value={a.company} onChange={set("company")} {...val.props("company")} /><FieldError k="company" msg={val.err("company")} /></div>
      <div className="field"><label>Address</label><input value={a.line1} onChange={set("line1")} autoComplete="address-line1" {...val.props("line1")} /><FieldError k="line1" msg={val.err("line1")} /></div>
      <div className="field"><label>Apartment, suite, etc</label><input value={a.line2} onChange={set("line2")} autoComplete="address-line2" /></div>
      <div className="row">
        <div className="field"><label>City</label><input value={a.city} onChange={set("city")} autoComplete="address-level2" {...val.props("city")} /><FieldError k="city" msg={val.err("city")} /></div>
        {regions.length ? (
          <div className="field"><label>{stateLabel}</label>
            <Select value={a.region} onChange={(e) => setA({ ...a, region: e.target.value })} {...val.props("region")}>
              <option value="">Select a {stateLabel.toLowerCase()}</option>
              {regions.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
            </Select>
            <FieldError k="region" msg={val.err("region")} />
          </div>
        ) : (
          <div className="field"><label>Region</label><input value={a.region} onChange={set("region")} {...val.props("region")} /><FieldError k="region" msg={val.err("region")} /></div>
        )}
        <div className="field"><label>{a.country === "US" ? "ZIP code" : "Postal code"}</label><input value={a.postcode} onChange={set("postcode")} autoComplete="postal-code"  {...val.props("postcode")} /><FieldError k="postcode" msg={val.err("postcode")} /></div>
      </div>
      <div className="field"><label>Phone</label><PhoneInput value={a.phone} invalid={!!val.err("phone")} onTouch={() => val.touch("phone")} onChange={(v) => setA({ ...a, phone: v })} defaultCountry={a.country === "GB" ? "GB" : a.country === "US" ? "US" : "CA"} /></div>
    </Modal>
  );
}
