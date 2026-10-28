"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type CustHit } from "@/lib/api";
import { Plus } from "../Icons";

const PAGE = 30;

// Search box with a dropdown: "Create a new customer" first, then every customer (loads more as you scroll).
export function CustomerPicker({ onPick, onCreate }: { onPick: (c: CustHit) => void; onCreate: (query: string) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<CustHit[]>([]);
  const [more, setMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0); // ignore responses that arrive after the query changed

  const load = useCallback(async (query: string, offset: number) => {
    const my = ++seq.current;
    setLoading(true);
    try {
      const rows = await api<CustHit[]>(`/customers/search?q=${encodeURIComponent(query)}&limit=${PAGE}&offset=${offset}`);
      if (my !== seq.current) return;
      setItems((cur) => (offset === 0 ? rows : [...cur, ...rows]));
      setMore(rows.length === PAGE);
    } catch {
      if (my === seq.current) setMore(false);
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => load(q.trim(), 0), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [q, open, load]);

  return (
    <div className="custpicker">
      <div className="searchfield">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3" /></svg>
        <input
          placeholder="Search or create a customer"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => e.key === "Escape" && (e.currentTarget.blur())}
        />
      </div>
      {open && (
        <div
          className="custlist"
          onScroll={(e) => {
            const el = e.currentTarget;
            if (more && !loading && el.scrollTop + el.clientHeight >= el.scrollHeight - 40) load(q.trim(), items.length);
          }}
        >
          <button className="create" onMouseDown={() => onCreate(q)}>
            <Plus />Create a new customer{q.trim() ? ` “${q.trim()}”` : ""}
          </button>
          {items.map((c) => (
            <button key={c.id} className="hit" onMouseDown={() => onPick(c)}>
              <span>{c.name || c.phone || c.email}</span>
              {(c.name ? c.email || c.phone : c.name ? "" : c.email && c.phone ? c.email : "") && <small>{c.name ? c.email || c.phone : c.email}</small>}
            </button>
          ))}
          {loading && <div className="muted" style={{ padding: 10 }}>Loading…</div>}
          {!loading && !items.length && <div className="muted" style={{ padding: 10 }}>{q.trim() ? "No customers found." : "No customers yet."}</div>}
        </div>
      )}
    </div>
  );
}
