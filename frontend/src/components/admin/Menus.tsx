"use client";

import { FieldError, type useValidation } from "./validation";
import { Plus } from "../Icons";

type Item = { label: string; url: string };

export const urlErr = (u: string) => (!u.trim() ? "Enter a link" : /^\/[^\s]*$/.test(u.trim()) || /^https?:\/\/[^\s]+$/.test(u.trim()) || /^mailto:[^\s@]+@[^\s@]+$/.test(u.trim()) ? "" : "Use a path like /pages/about, or a full https:// link");

export type { Item };
export function MenuCard({ title, hint, items, onChange, val, id, pages }: { title: string; hint: string; items: Item[]; onChange: (i: Item[]) => void; val: ReturnType<typeof useValidation>; id: string; pages: { handle: string; title: string }[] }) {
  const move = (i: number, d: number) => { const n = [...items]; const j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; onChange(n); };
  const set = (i: number, p: Partial<Item>) => onChange(items.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <div className="card">
      <h3>{title}</h3>
      <p className="muted" style={{ marginTop: -4 }}>{hint}</p>
      {items.map((it, i) => (
        <div key={i} className="row" style={{ alignItems: "flex-start" }}>
          <div className="field"><label htmlFor={`${id}-l${i}`}>Label</label><input id={`${id}-l${i}`} value={it.label} onChange={(e) => set(i, { label: e.target.value })} {...val.props(`${id}-l${i}`)} /><FieldError small k={`${id}-l${i}`} msg={val.err(`${id}-l${i}`)} /></div>
          <div className="field grow"><label htmlFor={`${id}-u${i}`}>Link</label><input id={`${id}-u${i}`} value={it.url} placeholder="/pages/about" onChange={(e) => set(i, { url: e.target.value })} {...val.props(`${id}-u${i}`)} /><FieldError small k={`${id}-u${i}`} msg={val.err(`${id}-u${i}`)} /></div>
          <div className="field" style={{ flex: "none", minWidth: 0, display: "flex", gap: 10, alignItems: "center", paddingTop: 22 }}>
            <button className="link" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
            <button className="link" aria-label="Move down" disabled={i === items.length - 1} onClick={() => move(i, 1)}>↓</button>
            <button className="link" onClick={() => onChange(items.filter((_, j) => j !== i))}>Remove</button>
          </div>
        </div>
      ))}
      <button onClick={() => onChange([...items, { label: "", url: "" }])}><Plus />Add menu item</button>
      {!!pages.length && (
        <p className="muted" style={{ marginBottom: 0 }}>Quick add a page:{" "}
          {pages.map((p) => <button key={p.handle} className="link" style={{ marginRight: 10 }} onClick={() => onChange([...items, { label: p.title, url: `/pages/${p.handle}` }])}>{p.title}</button>)}
        </p>
      )}
    </div>
  );
}
