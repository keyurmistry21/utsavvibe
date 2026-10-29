"use client";

import { useAdminMarket } from "@/lib/adminMarket";

// Admin-only control: which markets (= currencies) a staff member may sell in, create orders in and record expenses in.
// Empty list = all markets. Staff can't change this for themselves.
export function MarketAccess({ value, onChange, disabled, note }: { value: string[]; onChange: (v: string[]) => void; disabled?: boolean; note?: string }) {
  const { markets } = useAdminMarket();
  const all = value.length === 0;
  const toggle = (code: string) => onChange(value.includes(code) ? value.filter((c) => c !== code) : [...value, code]);
  return (
    <div className="field mktaccess">
      <label>Markets and currencies this person can work in</label>
      <div className="muted" style={{ marginBottom: 8 }}>They can only create orders, take payments and record expenses in these. They can't change this themselves.</div>
      <label className="optrow"><input type="radio" name="mkt-scope" checked={all} disabled={disabled} onChange={() => onChange([])} /><span><b>All markets</b></span></label>
      <label className="optrow"><input type="radio" name="mkt-scope" checked={!all} disabled={disabled} onChange={() => onChange(markets.slice(0, 1).map((m) => m.code))} /><span><b>Only these markets</b></span></label>
      {!all && (
        <div className="optlist">
          {markets.map((m) => (
            <label key={m.code} className="optrow"><input type="checkbox" checked={value.includes(m.code)} disabled={disabled || (value.length === 1 && value.includes(m.code))} onChange={() => toggle(m.code)} /><span>{m.name} <span className="muted">({m.currency})</span></span></label>
          ))}
        </div>
      )}
      {note && <div className="muted" style={{ marginTop: 6 }}>{note}</div>}
    </div>
  );
}
