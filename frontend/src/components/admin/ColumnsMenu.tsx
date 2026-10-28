"use client";

import { useEffect, useRef, useState } from "react";

export type ViewState<K extends string, S extends string> = { order: K[]; visible: K[]; sort: S; dir: "asc" | "desc" };

// Sort + column picker popover: eye toggles, drag handle or ↑/↓ to reorder. Shared by the Customers and Products lists.
export function ColumnsMenu<K extends string, S extends string>({ columns, sorts, view, setView, onClose }: {
  columns: { key: K; label: string }[];
  sorts: [S, string][];
  view: ViewState<K, S>;
  setView: (v: ViewState<K, S>) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  useEffect(() => {
    const out = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest(".colbtn")) onClose(); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", out); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", out); document.removeEventListener("keydown", esc); };
  }, [onClose]);

  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= view.order.length) return;
    const order = [...view.order];
    order.splice(to, 0, order.splice(from, 1)[0]);
    setView({ ...view, order });
  };
  const toggle = (k: K) => setView({ ...view, visible: view.visible.includes(k) ? view.visible.filter((x) => x !== k) : [...view.visible, k] });

  return (
    <div className="colmenu" ref={ref}>
      <div className="sortrow">
        <label htmlFor="sortby">Sort by</label>
        <select id="sortby" value={view.sort} onChange={(e) => setView({ ...view, sort: e.target.value as S })}>
          {sorts.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <button className="dirbtn" title={view.dir === "asc" ? "Ascending" : "Descending"} aria-label="Toggle sort direction" onClick={() => setView({ ...view, dir: view.dir === "asc" ? "desc" : "asc" })}>{view.dir === "asc" ? "↑" : "↓"}</button>
      </div>
      <div className="colhead">Columns</div>
      <ul>
        {view.order.map((k, i) => {
          const col = columns.find((c) => c.key === k)!;
          const on = view.visible.includes(k);
          return (
            <li
              key={k}
              draggable
              className={over === i ? "over" : ""}
              onDragStart={() => { drag.current = i; }}
              onDragOver={(e) => { e.preventDefault(); setOver(i); }}
              onDragLeave={() => setOver(null)}
              onDrop={() => { if (drag.current !== null) move(drag.current, i); drag.current = null; setOver(null); }}
              onDragEnd={() => { drag.current = null; setOver(null); }}
            >
              <span className="grip" aria-hidden="true">⠿</span>
              <span className={on ? "" : "dim"}>{col.label}</span>
              <span className="movers">
                <button aria-label={`Move ${col.label} up`} disabled={i === 0} onClick={() => move(i, i - 1)}>↑</button>
                <button aria-label={`Move ${col.label} down`} disabled={i === view.order.length - 1} onClick={() => move(i, i + 1)}>↓</button>
              </span>
              <button className="eye" aria-pressed={on} aria-label={`${on ? "Hide" : "Show"} ${col.label}`} title={on ? "Hide column" : "Show column"} onClick={() => toggle(k)}>
                <svg viewBox="0 0 24 24" aria-hidden="true">{on ? <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></> : <><path d="M3 3l18 18M10.6 5.1A9.8 9.8 0 0112 5c6.5 0 10 7 10 7a17 17 0 01-3.2 4.2M6.5 6.6C3.7 8.4 2 12 2 12s3.5 7 10 7c1.6 0 3-.4 4.3-1" /></>}</svg>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// Persisted view (order/visible/sort) that survives columns being added or removed later.
export function loadView<K extends string, S extends string>(key: string, all: K[], defaults: K[], sorts: S[], defSort: S): ViewState<K, S> {
  const def: ViewState<K, S> = { order: all, visible: defaults, sort: defSort, dir: "desc" };
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "null") as ViewState<K, S> | null;
    if (!v) return def;
    const order = [...v.order.filter((k) => all.includes(k)), ...all.filter((k) => !v.order.includes(k))];
    return { order, visible: v.visible.filter((k) => all.includes(k)), sort: sorts.includes(v.sort) ? v.sort : defSort, dir: v.dir === "asc" ? "asc" : "desc" };
  } catch { return def; }
}
export const saveView = (key: string, v: unknown) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} };
