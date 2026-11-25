"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { maxLen, required } from "@/lib/validators";
import { FieldError, useValidation } from "./validation";
import { ArrowLeft } from "../Icons";
import { RichTextEditor } from "./RichTextEditor";
import { Switch } from "./Switch";
import { useApi } from "./hooks";
import { useDirty, useUnsavedGuard } from "./unsaved";

type Row = { id: string; title: string; handle: string; visible: boolean; updatedAt: string; excerpt: string };
const when = (iso: string) => { const d = new Date(iso); return `${d.toLocaleDateString("en", { month: "short", day: "numeric" })} at ${d.toLocaleTimeString("en", { hour: "numeric", minute: "2-digit" }).toLowerCase()}`; };
type Form = { id?: string; title: string; handle: string; handleTouched: boolean; content: string; visible: boolean; seoTitle: string; seoDescription: string };
const blank = (): Form => ({ title: "", handle: "", handleTouched: false, content: "", visible: true, seoTitle: "", seoDescription: "" });
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100);
const storeUrl = (handle: string) => `/uk/pages/${handle}`;

function PageEditor({ initial, onDone }: { initial: Form; onDone: () => void }) {
  const [f, setF] = useState(initial);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [srv, setSrv] = useState("");
  const handle = f.handleTouched ? f.handle : slug(f.title);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((c) => ({ ...c, [k]: v }));
  const val = useValidation({
    title: required(f.title, "Enter a page title") || maxLen(f.title, 200, "The title"),
    handle: !handle ? "Enter a URL handle" : srv,
    seoTitle: maxLen(f.seoTitle, 200, "The page title"),
    seoDescription: maxLen(f.seoDescription, 500, "The description"),
  });

  const { dirty } = useDirty(f);
  const save = async (): Promise<boolean> => {
    if (!val.submit()) return false;
    setErr(""); setSaving(true);
    try {
      const body = { title: f.title.trim(), handle, content: f.content, visible: f.visible, seoTitle: f.seoTitle, seoDescription: f.seoDescription };
      const saved = await api<{ id: string; handle: string }>(f.id ? `/online-store/pages/${f.id}` : "/online-store/pages", { method: f.id ? "PUT" : "POST", json: body });
      setF((c) => ({ ...c, id: saved.id, handle: saved.handle, handleTouched: true }));
      allow();
      onDone();
      return true;
    } catch (e) {
      const msg = (e as Error).message;
      if (/URL handle/i.test(msg)) { setSrv(msg); val.touch("handle"); } else setErr(msg);
      setSaving(false);
      return false;
    }
  };
  const { guard, allow } = useUnsavedGuard(dirty, save);
  const cancel = () => { if (dirty && !confirm("Discard your changes?")) return; allow(); onDone(); };
  const remove = async () => {
    if (!f.id || !confirm("Delete this page? Its link will stop working.")) return;
    try { await api(`/online-store/pages/${f.id}`, { method: "DELETE" }); allow(); onDone(); } catch (e) { setErr((e as Error).message); }
  };

  return (
    <>
      {guard}
      <div className="crumbbar"><button className="link crumb" onClick={cancel}><ArrowLeft />Pages</button></div>
      <div className="pagehead"><h2>{f.id ? f.title || "Page" : "Add page"}</h2></div>
      {err && <div className="error">{err}</div>}
      <div className="cols">
        <div>
          <div className="card">
            <div className="field"><label htmlFor="pg-title">Title</label><input id="pg-title" autoFocus value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. About us, Shipping policy" {...val.props("title")} /><FieldError k="title" msg={val.err("title")} /></div>
            <div className="field" style={{ marginBottom: 0 }}><label>Content</label>
              <RichTextEditor value={f.content} onChange={(h) => set("content", h)} resetKey={f.id ?? "new"} placeholder="Write the page content…" />
            </div>
          </div>
          <div className="card">
            <h3>Search engine listing</h3>
            <div className="seourl">{typeof location !== "undefined" ? location.host : ""} › pages › {handle || "page-handle"}</div>
            <div className="field"><label htmlFor="pg-seot">Page title</label><input id="pg-seot" value={f.seoTitle} placeholder={f.title} onChange={(e) => set("seoTitle", e.target.value)} {...val.props("seoTitle")} /><FieldError k="seoTitle" msg={val.err("seoTitle")} /></div>
            <div className="field"><label htmlFor="pg-seod">Meta description</label><textarea id="pg-seod" rows={3} value={f.seoDescription} onChange={(e) => set("seoDescription", e.target.value)} {...val.props("seoDescription")} /><FieldError k="seoDescription" msg={val.err("seoDescription")} /></div>
            <div className="field" style={{ marginBottom: 0 }}><label htmlFor="pg-handle">URL handle</label>
              <div className="prefixed" aria-invalid={val.err("handle") ? true : undefined}><span>/pages/</span><input id="pg-handle" value={handle} onChange={(e) => { setSrv(""); setF((c) => ({ ...c, handle: slug(e.target.value), handleTouched: true })); }} onBlur={() => val.touch("handle")} /></div>
              <FieldError k="handle" msg={val.err("handle")} />
            </div>
          </div>
        </div>
        <aside className="sideform">
          <div className="card">
            <div className="cardhead"><h3>Visibility</h3><Switch checked={f.visible} onChange={(v) => set("visible", v)} label="Visible" /></div>
            <p className="muted" style={{ margin: 0 }}>{f.visible ? "Visible: customers can open this page." : "Hidden: only you can see it, customers get a 404."}</p>
            {f.id && f.visible && <p style={{ marginBottom: 0 }}><a className="lnk" href={storeUrl(f.handle)} target="_blank" rel="noreferrer">View page</a></p>}
          </div>
        </aside>
      </div>
      <div className="savebar">
        {f.id && <button className="danger" onClick={remove}>Delete page</button>}
        <span style={{ flex: 1 }} />
        <button onClick={cancel}>Discard</button>
        <button className="primary" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save"}</button>
      </div>
    </>
  );
}

export function Pages() {
  const [q, setQ] = useState("");
  const [asc, setAsc] = useState(false); // false = newest first
  const { data: rows, error, reload } = useApi<Row[]>(`/online-store/pages?q=${encodeURIComponent(q)}`);
  const [form, setForm] = useState<Form | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [err, setErr] = useState("");
  useEffect(() => { if (new URLSearchParams(location.search).get("new")) { history.replaceState(null, "", location.pathname); setForm(blank()); } }, []);

  const edit = async (id: string) => {
    try {
      const p = await api<{ id: string; title: string; handle: string; content: string; visible: boolean; seoTitle: string; seoDescription: string }>(`/online-store/pages/${id}`);
      setForm({ ...p, handleTouched: true });
    } catch (e) { setErr((e as Error).message); }
  };
  const bulk = async (action: "show" | "hide" | "delete") => {
    if (action === "delete" && !confirm(`Delete ${sel.size} page${sel.size === 1 ? "" : "s"}?`)) return;
    try { await api("/online-store/pages/bulk", { method: "POST", json: { ids: [...sel], action } }); setSel(new Set()); reload(); } catch (e) { setErr((e as Error).message); }
  };

  if (form) return <PageEditor key={form.id ?? "new"} initial={form} onDone={() => { setForm(null); reload(); }} />;
  const all = !!rows?.length && rows.every((r) => sel.has(r.id));
  return (
    <>
      <div className="pagehead">
        <h2>Pages</h2>
        <div className="headtools"><button className="primary" onClick={() => setForm(blank())}>Add page</button></div>
      </div>
      {(error || err) && <div className="error">{error || err}</div>}
      <div className="card">
        <div className="field"><label htmlFor="pg-q">Search pages</label><input id="pg-q" value={q} placeholder="Title or handle" onChange={(e) => setQ(e.target.value)} /></div>
        {sel.size > 0 && (
          <span className="bulkbar"><b>{sel.size} selected</b>
            <button onClick={() => bulk("show")}>Make visible</button><button onClick={() => bulk("hide")}>Hide</button><button className="danger" onClick={() => bulk("delete")}>Delete</button>
          </span>
        )}
        <div className="tablescroll">
          <table>
            <thead><tr><th style={{ width: 32 }}><input type="checkbox" aria-label="Select all" checked={all} onChange={(e) => setSel(e.target.checked ? new Set(rows?.map((r) => r.id)) : new Set())} /></th><th><button className="link sortbtn" onClick={() => setAsc(!asc)} aria-label="Sort by title">Title ⇅</button></th><th>Visibility</th><th>Content</th><th style={{ textAlign: "right" }}>Updated</th></tr></thead>
            <tbody>
              {(rows ? (asc ? [...rows].sort((a, b) => a.title.localeCompare(b.title)) : rows) : []).map((r) => (
                <tr key={r.id} className="clickable" onClick={() => edit(r.id)}>
                  <td onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Select ${r.title}`} checked={sel.has(r.id)} onChange={(e) => setSel((c) => { const n = new Set(c); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n; })} /></td>
                  <td><b>{r.title}</b></td>
                  <td><span className={`badge ${r.visible ? "ok" : ""}`}>{r.visible ? "Visible" : "Hidden"}</span></td>
                  <td className="muted excerpt">{r.excerpt}</td>
                  <td className="muted" style={{ textAlign: "right", whiteSpace: "nowrap" }}>{when(r.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows && !rows.length && <p className="muted">{q ? "No pages match your search." : "No pages yet. Add one for About us, shipping or returns policy."}</p>}
      </div>
    </>
  );
}
