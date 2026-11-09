"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { maxLen, required } from "@/lib/validators";
import { FieldError, useValidation } from "./validation";
import { ArrowLeft } from "../Icons";
import { Modal } from "./Modal";
import { RichTextEditor } from "./RichTextEditor";
import { Switch } from "./Switch";
import { useApi } from "./hooks";
import { Select } from "../Select";
import { SearchField } from "./SearchField";

type Row = { id: string; title: string; handle: string; kind: "manual" | "smart"; visible: boolean; productCount: number; updatedAt: string };
type Prod = { id: string; title: string; status: string; thumbUrl: string | null };
type Cond = { field: "tag" | "vendor" | "type" | "title"; op: "is" | "contains"; value: string };
type Form = {
  id?: string; title: string; handle: string; handleTouched: boolean; description: string; kind: "manual" | "smart";
  match: "all" | "any"; conditions: Cond[]; products: Prod[]; visible: boolean; seoTitle: string; seoDescription: string;
};
const blank = (): Form => ({ title: "", handle: "", handleTouched: false, description: "", kind: "manual", match: "all", conditions: [{ field: "tag", op: "is", value: "" }], products: [], visible: true, seoTitle: "", seoDescription: "" });
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100);
const FIELD_LABEL = { tag: "Tag", vendor: "Vendor", type: "Product type", title: "Title" } as const;

function AddProducts({ have, onAdd, onClose }: { have: Set<string>; onAdd: (p: Prod[]) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Record<string, Prod>>({});
  const { data } = useApi<{ items: Prod[] }>(`/products/list?limit=100&q=${encodeURIComponent(q)}`);
  const n = Object.keys(sel).length;
  return (
    <Modal title="Add products" onClose={onClose} footer={<><span className="muted">{n ? `${n} selected` : "Select products to add"}</span><span style={{ display: "flex", gap: 8 }}><button onClick={onClose}>Cancel</button><button className="primary" disabled={!n} onClick={() => onAdd(Object.values(sel))}>Add</button></span></>}>
      <SearchField autoFocus className="pickersearch" placeholder="Search products" value={q} onChange={setQ} />
      <div className="pickerlist">
        {(data?.items ?? []).filter((p) => !have.has(p.id)).map((p) => (
          <label key={p.id} className="pickprod check" style={{ cursor: "pointer" }}>
            <input type="checkbox" checked={!!sel[p.id]} onChange={(e) => setSel((c) => { const x = { ...c }; if (e.target.checked) x[p.id] = p; else delete x[p.id]; return x; })} />
            {p.thumbUrl ? <img className="listthumb" src={p.thumbUrl} alt="" /> : <span className="listthumb noimg" />}
            <b>{p.title}</b>{p.status !== "active" && <span className="badge">{p.status}</span>}
          </label>
        ))}
        {data && !data.items.filter((p) => !have.has(p.id)).length && <p className="muted">No more products to add.</p>}
      </div>
    </Modal>
  );
}

function Editor({ initial, onDone }: { initial: Form; onDone: () => void }) {
  const [f, setF] = useState(initial);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [srv, setSrv] = useState("");
  const [adding, setAdding] = useState(false);
  const [preview, setPreview] = useState<{ count: number; products: Prod[] } | null>(null);
  const handle = f.handleTouched ? f.handle : slug(f.title);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((c) => ({ ...c, [k]: v }));
  const setCond = (i: number, p: Partial<Cond>) => setF((c) => ({ ...c, conditions: c.conditions.map((x, j) => (j === i ? { ...x, ...p } : x)) }));

  const E: Record<string, string> = {
    title: required(f.title, "Enter a collection title") || maxLen(f.title, 200, "The title"),
    handle: !handle ? "Enter a URL handle" : srv,
    seoTitle: maxLen(f.seoTitle, 200, "The page title"),
    seoDescription: maxLen(f.seoDescription, 500, "The description"),
  };
  f.conditions.forEach((c, i) => { E[`cond${i}`] = f.kind === "smart" ? required(c.value, "Enter a value") : ""; });
  E.rules = f.kind === "smart" && !f.conditions.length ? "Add at least one rule" : "";
  const val = useValidation(E);

  // live preview of what the rules match (debounced)
  const rulesKey = JSON.stringify([f.match, f.conditions]);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (f.kind !== "smart") return;
    const ready = f.conditions.filter((c) => c.value.trim());
    if (!ready.length) { setPreview(null); return; }
    if (t.current) clearTimeout(t.current);
    t.current = setTimeout(() => { api<{ count: number; products: Prod[] }>("/collections/preview", { method: "POST", json: { rules: { match: f.match, conditions: ready } } }).then(setPreview).catch(() => setPreview(null)); }, 350);
    return () => { if (t.current) clearTimeout(t.current); };
  }, [rulesKey, f.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!val.submit()) return;
    setErr(""); setSaving(true);
    try {
      const body = {
        title: f.title.trim(), handle, description: f.description, kind: f.kind, visible: f.visible, seoTitle: f.seoTitle, seoDescription: f.seoDescription,
        rules: { match: f.match, conditions: f.conditions.filter((c) => c.value.trim()).map((c) => ({ ...c, value: c.value.trim() })) },
        productIds: f.products.map((p) => p.id),
      };
      await api(f.id ? `/collections/${f.id}` : "/collections", { method: f.id ? "PUT" : "POST", json: body });
      onDone();
    } catch (e) {
      const msg = (e as Error).message;
      if (/URL handle/i.test(msg)) { setSrv(msg); val.touch("handle"); } else setErr(msg);
      setSaving(false);
    }
  };
  const remove = async () => {
    if (!f.id || !confirm("Delete this collection? The products stay, only the grouping is removed.")) return;
    try { await api(`/collections/${f.id}`, { method: "DELETE" }); onDone(); } catch (e) { setErr((e as Error).message); }
  };
  const move = (i: number, d: number) => setF((c) => { const n = [...c.products]; const j = i + d; if (j < 0 || j >= n.length) return c; [n[i], n[j]] = [n[j], n[i]]; return { ...c, products: n }; });

  return (
    <>
      <div className="crumbbar"><button className="link crumb" onClick={onDone}><ArrowLeft />Collections</button></div>
      <div className="pagehead"><h2>{f.id ? f.title || "Collection" : "Create collection"}</h2></div>
      {err && <div className="error">{err}</div>}
      <div className="cols">
        <div>
          <div className="card">
            <div className="field"><label htmlFor="co-title">Title</label><input id="co-title" autoFocus value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Diwali gifts, Brass idols" {...val.props("title")} /><FieldError k="title" msg={val.err("title")} /></div>
            <div className="field" style={{ marginBottom: 0 }}><label>Description</label><RichTextEditor value={f.description} onChange={(h) => set("description", h)} resetKey={f.id ?? "new"} placeholder="Describe this collection…" /></div>
          </div>

          <div className="card">
            <h3>Products</h3>
            <div className="seg" role="radiogroup" aria-label="How products are added">
              <label className="check"><input type="radio" name="kind" checked={f.kind === "manual"} onChange={() => set("kind", "manual")} />Manual: I pick the products</label>
              <label className="check"><input type="radio" name="kind" checked={f.kind === "smart"} onChange={() => set("kind", "smart")} />Automated: products that match rules join by themselves</label>
            </div>
            {f.kind === "manual" ? (
              <>
                {f.products.map((p, i) => (
                  <div key={p.id} className="row" style={{ alignItems: "center", gap: 10, marginBottom: 6 }}>
                    {p.thumbUrl ? <img className="listthumb" src={p.thumbUrl} alt="" /> : <span className="listthumb noimg" />}
                    <span style={{ flex: 1 }}><b>{p.title}</b> {p.status !== "active" && <span className="badge">{p.status}</span>}</span>
                    <button className="link" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                    <button className="link" aria-label="Move down" disabled={i === f.products.length - 1} onClick={() => move(i, 1)}>↓</button>
                    <button className="link" onClick={() => set("products", f.products.filter((x) => x.id !== p.id))}>Remove</button>
                  </div>
                ))}
                {!f.products.length && <p className="muted">No products yet.</p>}
                <button onClick={() => setAdding(true)}>Add products</button>
              </>
            ) : (
              <>
                <div className="field"><label>Products must match</label>
                  <Select value={f.match} onChange={(e) => set("match", e.target.value as "all" | "any")}><option value="all">all rules</option><option value="any">any rule</option></Select>
                </div>
                {f.conditions.map((c, i) => (
                  <div key={i} className="row" style={{ alignItems: "flex-start" }}>
                    <div className="field"><label>Rule {i + 1}</label><Select value={c.field} onChange={(e) => setCond(i, { field: e.target.value as Cond["field"] })}>{Object.entries(FIELD_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></div>
                    <div className="field"><label>Is</label><Select value={c.op} onChange={(e) => setCond(i, { op: e.target.value as Cond["op"] })}><option value="is">equal to</option><option value="contains">contains</option></Select></div>
                    <div className="field grow"><label htmlFor={`co-v${i}`}>Value</label><input id={`co-v${i}`} value={c.value} onChange={(e) => setCond(i, { value: e.target.value })} {...val.props(`cond${i}`)} /><FieldError k={`cond${i}`} msg={val.err(`cond${i}`)} /></div>
                    <div className="field" style={{ flex: "none", minWidth: 0, paddingTop: 22 }}><button className="link" onClick={() => set("conditions", f.conditions.filter((_, j) => j !== i))}>Remove</button></div>
                  </div>
                ))}
                <FieldError k="rules" msg={val.err("rules")} />
                <button onClick={() => set("conditions", [...f.conditions, { field: "tag", op: "is", value: "" }])}>Add rule</button>
                {preview && (
                  <p className="muted" style={{ marginBottom: 0 }}>
                    {preview.count} product{preview.count === 1 ? "" : "s"} match{preview.count === 1 ? "es" : ""} right now{preview.products.length ? `: ${preview.products.map((p) => p.title).join(", ")}${preview.count > preview.products.length ? "…" : ""}` : "."}
                  </p>
                )}
              </>
            )}
          </div>

          <div className="card">
            <h3>Search engine listing</h3>
            <div className="seourl">{typeof location !== "undefined" ? location.host : ""} › collections › {handle || "collection-handle"}</div>
            <div className="field"><label htmlFor="co-seot">Page title</label><input id="co-seot" value={f.seoTitle} placeholder={f.title} onChange={(e) => set("seoTitle", e.target.value)} {...val.props("seoTitle")} /><FieldError k="seoTitle" msg={val.err("seoTitle")} /></div>
            <div className="field"><label htmlFor="co-seod">Meta description</label><textarea id="co-seod" rows={3} value={f.seoDescription} onChange={(e) => set("seoDescription", e.target.value)} {...val.props("seoDescription")} /><FieldError k="seoDescription" msg={val.err("seoDescription")} /></div>
            <div className="field" style={{ marginBottom: 0 }}><label htmlFor="co-handle">URL handle</label>
              <div className="prefixed" aria-invalid={val.err("handle") ? true : undefined}><span>/collections/</span><input id="co-handle" value={handle} onChange={(e) => { setSrv(""); setF((c) => ({ ...c, handle: slug(e.target.value), handleTouched: true })); }} onBlur={() => val.touch("handle")} /></div>
              <FieldError k="handle" msg={val.err("handle")} />
            </div>
          </div>
        </div>
        <aside className="sideform">
          <div className="card">
            <div className="cardhead"><h3>Visibility</h3><Switch checked={f.visible} onChange={(v) => set("visible", v)} label="Visible" /></div>
            <p className="muted" style={{ margin: 0 }}>{f.visible ? "Visible: customers can open this collection." : "Hidden: customers get a 404."}</p>
            {f.id && f.visible && <p style={{ marginBottom: 0 }}><a className="lnk" href={`/uk/collections/${f.handle}`} target="_blank" rel="noreferrer">View collection</a></p>}
          </div>
        </aside>
      </div>
      <div className="savebar">
        {f.id && <button className="danger" onClick={remove}>Delete collection</button>}
        <span style={{ flex: 1 }} />
        <button onClick={onDone}>Discard</button>
        <button className="primary" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save"}</button>
      </div>
      {adding && <AddProducts have={new Set(f.products.map((p) => p.id))} onClose={() => setAdding(false)} onAdd={(ps) => { set("products", [...f.products, ...ps]); setAdding(false); }} />}
    </>
  );
}

export function Collections() {
  const [q, setQ] = useState("");
  const { data: rows, error, reload } = useApi<Row[]>(`/collections?q=${encodeURIComponent(q)}`);
  const [form, setForm] = useState<Form | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [err, setErr] = useState("");
  useEffect(() => { if (new URLSearchParams(location.search).get("new")) { history.replaceState(null, "", location.pathname); setForm(blank()); } }, []);

  const edit = async (id: string) => {
    try {
      const c = await api<{ id: string; title: string; handle: string; description: string; kind: Form["kind"]; rules: { match: "all" | "any"; conditions: Cond[] }; products: Prod[]; visible: boolean; seoTitle: string; seoDescription: string }>(`/collections/${id}`);
      setForm({ id: c.id, title: c.title, handle: c.handle, handleTouched: true, description: c.description, kind: c.kind, match: c.rules.match, conditions: c.rules.conditions.length ? c.rules.conditions : [{ field: "tag", op: "is", value: "" }], products: c.kind === "manual" ? c.products : [], visible: c.visible, seoTitle: c.seoTitle, seoDescription: c.seoDescription });
    } catch (e) { setErr((e as Error).message); }
  };
  const bulk = async (action: "show" | "hide" | "delete") => {
    if (action === "delete" && !confirm(`Delete ${sel.size} collection${sel.size === 1 ? "" : "s"}? Products are not deleted.`)) return;
    try { await api("/collections/bulk", { method: "POST", json: { ids: [...sel], action } }); setSel(new Set()); reload(); } catch (e) { setErr((e as Error).message); }
  };

  if (form) return <Editor key={form.id ?? "new"} initial={form} onDone={() => { setForm(null); reload(); }} />;
  const all = !!rows?.length && rows.every((r) => sel.has(r.id));
  return (
    <>
      <div className="pagehead"><h2>Collections</h2><div className="headtools"><button className="primary" onClick={() => setForm(blank())}>Create collection</button></div></div>
      {(error || err) && <div className="error">{error || err}</div>}
      <div className="card">
        <div className="field"><label htmlFor="co-q">Search collections</label><input id="co-q" value={q} placeholder="Title or handle" onChange={(e) => setQ(e.target.value)} /></div>
        {sel.size > 0 && <span className="bulkbar"><b>{sel.size} selected</b><button onClick={() => bulk("show")}>Make visible</button><button onClick={() => bulk("hide")}>Hide</button><button className="danger" onClick={() => bulk("delete")}>Delete</button></span>}
        <div className="tablescroll">
          <table>
            <thead><tr><th style={{ width: 32 }}><input type="checkbox" aria-label="Select all" checked={all} onChange={(e) => setSel(e.target.checked ? new Set(rows?.map((r) => r.id)) : new Set())} /></th><th>Title</th><th>Type</th><th>Visibility</th><th style={{ textAlign: "right" }}>Products</th></tr></thead>
            <tbody>
              {(rows ?? []).map((r) => (
                <tr key={r.id} className="clickable" onClick={() => edit(r.id)}>
                  <td onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Select ${r.title}`} checked={sel.has(r.id)} onChange={(e) => setSel((c) => { const n = new Set(c); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n; })} /></td>
                  <td><b>{r.title}</b></td>
                  <td className="muted">{r.kind === "smart" ? "Automated" : "Manual"}</td>
                  <td><span className={`badge ${r.visible ? "ok" : ""}`}>{r.visible ? "Visible" : "Hidden"}</span></td>
                  <td style={{ textAlign: "right" }}>{r.productCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows && !rows.length && <p className="muted">{q ? "No collections match your search." : "No collections yet. Group products such as Diwali gifts or Brass idols so customers can browse them."}</p>}
      </div>
    </>
  );
}
