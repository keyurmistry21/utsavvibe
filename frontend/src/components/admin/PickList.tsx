"use client";

import { useEffect, useRef, useState } from "react";

type Opt = { id: string; label: string };

// Chips of what is chosen plus a "+" that opens a searchable list of what already exists, so nobody has to remember spellings.
export function PickList({ options, selected, onChange, placeholder, allowCreate, label }: {
  options: Opt[]; selected: string[]; onChange: (ids: string[]) => void; placeholder: string; allowCreate?: boolean; label: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", off); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", off); document.removeEventListener("keydown", esc); };
  }, [open]);

  const nameOf = (id: string) => options.find((o) => o.id === id)?.label ?? id;
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const needle = q.trim().toLowerCase();
  const shown = options.filter((o) => !needle || o.label.toLowerCase().includes(needle));
  const canCreate = allowCreate && needle && !options.some((o) => o.label.toLowerCase() === needle) && !selected.some((s) => s.toLowerCase() === needle);

  return (
    <div className="picklist" ref={box}>
      <div className="picklist-chips">
        {selected.map((id) => <span key={id} className="chip">{nameOf(id)}<button type="button" aria-label={`Remove ${nameOf(id)}`} onClick={() => toggle(id)}>×</button></span>)}
        <button type="button" className="picklist-add" aria-expanded={open} aria-label={`Choose ${label}`} onClick={() => setOpen((o) => !o)}>+ {selected.length ? "Add" : placeholder}</button>
      </div>
      {open && (
        <div className="picklist-pop" role="listbox" aria-label={label}>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={allowCreate ? "Search or type a new one" : "Search"} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (canCreate) { onChange([...selected, q.trim()]); setQ(""); } else if (shown.length === 1) toggle(shown[0].id); } }} />
          <div className="picklist-list">
            {canCreate && <button type="button" className="picklist-new" onClick={() => { onChange([...selected, q.trim()]); setQ(""); }}>+ Create “{q.trim()}”</button>}
            {shown.map((o) => (
              <label key={o.id}><input type="checkbox" checked={selected.includes(o.id)} onChange={() => toggle(o.id)} />{o.label}</label>
            ))}
            {!shown.length && !canCreate && <div className="muted" style={{ padding: "8px 10px" }}>{options.length ? "Nothing matches." : "Nothing here yet."}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
