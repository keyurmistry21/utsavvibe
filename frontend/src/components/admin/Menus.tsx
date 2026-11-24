"use client";

import { FieldError, type useValidation } from "./validation";
import { Plus } from "../Icons";

type Sub = { label: string; url: string };
type Item = { label: string; url: string; children?: Sub[] };

export const urlErr = (u: string) => (!u.trim() ? "Enter a link" : /^\/[^\s]*$/.test(u.trim()) || /^https?:\/\/[^\s]+$/.test(u.trim()) || /^mailto:[^\s@]+@[^\s@]+$/.test(u.trim()) ? "" : "Use a path like /pages/about, or a full https:// link");

export type { Item };
export function MenuCard({ title, hint, items, onChange, val, id, quick, subs }: { title: string; hint: string; items: Item[]; onChange: (i: Item[]) => void; val: ReturnType<typeof useValidation>; id: string; quick: { label: string; url: string }[]; subs?: boolean }) {
  const move = (i: number, d: number) => { const n = [...items]; const j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; onChange(n); };
  const set = (i: number, p: Partial<Item>) => onChange(items.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const setSub = (i: number, j: number, p: Partial<Sub>) => set(i, { children: (items[i].children ?? []).map((c, k) => (k === j ? { ...c, ...p } : c)) });
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
          {subs && (
            <div style={{ flexBasis: "100%", margin: "-4px 0 10px 18px", paddingLeft: 12, borderLeft: "2px solid #e3e3e3" }}>
              {(it.children ?? []).map((c, j) => (
                <div key={j} className="row" style={{ alignItems: "flex-start" }}>
                  <div className="field"><label htmlFor={`${id}-sl${i}-${j}`}>Drop-down label</label><input id={`${id}-sl${i}-${j}`} value={c.label} onChange={(e) => setSub(i, j, { label: e.target.value })} {...val.props(`${id}-sl${i}-${j}`)} /><FieldError small k={`${id}-sl${i}-${j}`} msg={val.err(`${id}-sl${i}-${j}`)} /></div>
                  <div className="field grow"><label htmlFor={`${id}-su${i}-${j}`}>Link</label><input id={`${id}-su${i}-${j}`} value={c.url} placeholder="/collections/all-rakhi" onChange={(e) => setSub(i, j, { url: e.target.value })} {...val.props(`${id}-su${i}-${j}`)} /><FieldError small k={`${id}-su${i}-${j}`} msg={val.err(`${id}-su${i}-${j}`)} /></div>
                  <div className="field" style={{ flex: "none", minWidth: 0, paddingTop: 22 }}><button className="link" onClick={() => set(i, { children: (it.children ?? []).filter((_, k) => k !== j) })}>Remove</button></div>
                </div>
              ))}
              <button className="link" onClick={() => set(i, { children: [...(it.children ?? []), { label: "", url: "" }] })}>+ Add drop-down link</button>
            </div>
          )}
        </div>
      ))}
      <button onClick={() => onChange([...items, { label: "", url: "" }])}><Plus />Add menu item</button>
      {!!quick.length && (
        <p className="muted" style={{ marginBottom: 0 }}>Quick add:{" "}
          {quick.map((p) => <button key={p.url} className="link" style={{ marginRight: 10 }} onClick={() => onChange([...items, { label: p.label, url: p.url }])}>{p.label}</button>)}
        </p>
      )}
    </div>
  );
}
