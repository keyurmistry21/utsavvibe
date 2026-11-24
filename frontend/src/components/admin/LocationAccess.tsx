"use client";

import { api } from "@/lib/api";
import { useApi } from "./hooks";

type Loc = { id: string; name: string; active: boolean };

// Admin-only control: which store locations a staff member may sell from and move stock at. Empty = all locations.
export function LocationAccess({ value, onChange, disabled }: { value: string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  const { data } = useApi<Loc[]>("/locations");
  const locs = (data ?? []).filter((l) => l.active);
  if (locs.length < 2) return null; // nothing to choose with a single location
  const all = value.length === 0;
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  void api;
  return (
    <div className="field mktaccess">
      <label>Store locations this person can work at</label>
      <div className="muted" style={{ marginBottom: 8 }}>They can sell from and move stock at only these locations, and see only their in-store sales.</div>
      <label className="optrow"><input type="radio" name="loc-scope" checked={all} disabled={disabled} onChange={() => onChange([])} /><span><b>All locations</b></span></label>
      <label className="optrow"><input type="radio" name="loc-scope" checked={!all} disabled={disabled} onChange={() => onChange(locs.slice(0, 1).map((l) => l.id))} /><span><b>Only these locations</b></span></label>
      {!all && (
        <div className="optlist">
          {locs.map((l) => (
            <label key={l.id} className="optrow"><input type="checkbox" checked={value.includes(l.id)} disabled={disabled || (value.length === 1 && value.includes(l.id))} onChange={() => toggle(l.id)} /><span>{l.name}</span></label>
          ))}
        </div>
      )}
    </div>
  );
}
