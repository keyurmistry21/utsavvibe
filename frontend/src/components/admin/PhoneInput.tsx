"use client";

import { useState } from "react";
import { dialCodes, joinPhone, splitPhone } from "@/lib/countries";

// Country code select + number. Value is stored as "+44 7700900123" (empty when no number).
export function PhoneInput({ value, onChange, defaultCountry = "CA" }: { value: string; onChange: (v: string) => void; defaultCountry?: string }) {
  const init = splitPhone(value, defaultCountry);
  const [code, setCode] = useState(init.code);
  const [number, setNumber] = useState(init.number);
  const push = (c: string, n: string) => onChange(joinPhone(c, n));
  return (
    <div className="phoneinput">
      <select value={code} onChange={(e) => { setCode(e.target.value); push(e.target.value, number); }} aria-label="Country code">
        {dialCodes.map((d) => <option key={d.code} value={d.code}>{d.name} ({d.dial})</option>)}
      </select>
      <input value={number} inputMode="tel" onChange={(e) => { setNumber(e.target.value); push(code, e.target.value); }} />
    </div>
  );
}
