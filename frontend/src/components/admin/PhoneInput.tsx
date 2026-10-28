"use client";

import { useState } from "react";
import { dialCodes, joinPhone, splitPhone } from "@/lib/countries";
import { Select } from "../Select";

// Country code select + number. Value is stored as "+44 7700900123" (empty when no number).
export function PhoneInput({ value, onChange, defaultCountry = "CA", invalid, onTouch, id }: { value: string; onChange: (v: string) => void; defaultCountry?: string; invalid?: boolean; onTouch?: () => void; id?: string }) {
  const init = splitPhone(value, defaultCountry);
  const [code, setCode] = useState(init.code);
  const [number, setNumber] = useState(init.number);
  const push = (c: string, n: string) => onChange(joinPhone(c, n));
  return (
    <div className="phoneinput">
      <Select value={code} onChange={(e) => { setCode(e.target.value); push(e.target.value, number); }} aria-label="Country code">
        {dialCodes.map((d) => <option key={d.code} value={d.code}>{d.name} ({d.dial})</option>)}
      </Select>
      <input id={id} value={number} inputMode="tel" autoComplete="tel-national" aria-invalid={invalid || undefined} onBlur={onTouch} onChange={(e) => { setNumber(e.target.value); push(code, e.target.value); }} />
    </div>
  );
}
