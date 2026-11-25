"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { maxLen, required } from "@/lib/validators";
import { FieldError, useValidation } from "./validation";
import { ArrowLeft } from "../Icons";
import { RichTextEditor } from "./RichTextEditor";
import { Switch } from "./Switch";
import { useApi } from "./hooks";
import { useDirty, useUnsavedGuard } from "./unsaved";

type Row = { id: string; title: string; handle: string; author: string; published: boolean; publishedAt: string | null; updatedAt: string; excerpt: string };
type Form = {
  id?: string; title: string; handle: string; handleTouched: boolean; content: string; excerpt: string; author: string; tagsText: string; coverImage: string;
  published: boolean; publishedAt: string; seoTitle: string; seoDescription: string;
};
const blank = (): Form => ({ title: "", handle: "", handleTouched: false, content: "", excerpt: "", author: "", tagsText: "", coverImage: "", published: false, publishedAt: "", seoTitle: "", seoDescription: "" });
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100);
const when = (iso: string) => new Date(iso).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" });
// <input type="datetime-local"> works in local time without a zone
const toLocalInput = (iso: string | null) => { if (!iso) return ""; const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const state = (r: { published: boolean; publishedAt: string | null }) => (!r.published ? "Draft" : r.publishedAt && new Date(r.publishedAt) > new Date() ? "Scheduled" : "Published");

function Editor({ initial, onDone }: { initial: Form; onDone: () => void }) {
  const [f, setF] = useState(initial);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [srv, setSrv] = useState("");
  const [upErr, setUpErr] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const handle = f.handleTouched ? f.handle : slug(f.title);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((c) => ({ ...c, [k]: v }));
  const val = useValidation({
    title: required(f.title, "Enter a post title") || maxLen(f.title, 200, "The title"),
    handle: !handle ? "Enter a URL handle" : srv,
    excerpt: maxLen(f.excerpt, 500, "The excerpt"),
    author: maxLen(f.author, 100, "The author"),
    coverImage: f.coverImage && !/^\/uploads\/[\w.-]+$/.test(f.coverImage) && !/^https:\/\/\S+$/.test(f.coverImage) ? "Use an https:// image address, or upload a picture" : "",
    seoTitle: maxLen(f.seoTitle, 200, "The page title"),
    seoDescription: maxLen(f.seoDescription, 500, "The description"),
  });

  const upload = async (file: File) => {
    setUpErr(""); setUploading(true);
    try {
      if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) throw new Error("Only JPEG, PNG, WebP or GIF images");
      const r = await fetch("/api/admin/blog/images", { method: "POST", credentials: "same-origin", headers: { "content-type": file.type }, body: file });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? r.statusText);
      set("coverImage", d.url);
    } catch (e) { setUpErr((e as Error).message); } finally { setUploading(false); }
  };

  const { dirty } = useDirty(f);
  const save = async (): Promise<boolean> => {
    if (!val.submit()) return false;
    setErr(""); setSaving(true);
    try {
      const body = {
        title: f.title.trim(), handle, content: f.content, excerpt: f.excerpt, author: f.author, tags: f.tagsText.split(",").map((t) => t.trim()).filter(Boolean),
        coverImage: f.coverImage, published: f.published, publishedAt: f.publishedAt ? new Date(f.publishedAt).toISOString() : null, seoTitle: f.seoTitle, seoDescription: f.seoDescription,
      };
      await api(f.id ? `/blog/posts/${f.id}` : "/blog/posts", { method: f.id ? "PUT" : "POST", json: body });
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
    if (!f.id || !confirm("Delete this post? Its link will stop working.")) return;
    try { await api(`/blog/posts/${f.id}`, { method: "DELETE" }); allow(); onDone(); } catch (e) { setErr((e as Error).message); }
  };
  const scheduled = f.published && f.publishedAt && new Date(f.publishedAt) > new Date();

  return (
    <>
      {guard}
      <div className="crumbbar"><button className="link crumb" onClick={cancel}><ArrowLeft />Blog posts</button></div>
      <div className="pagehead"><h2>{f.id ? f.title || "Post" : "Add blog post"}</h2></div>
      {err && <div className="error">{err}</div>}
      <div className="cols">
        <div>
          <div className="card">
            <div className="field"><label htmlFor="bp-title">Title</label><input id="bp-title" autoFocus value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. How to set up your Diwali pooja" {...val.props("title")} /><FieldError k="title" msg={val.err("title")} /></div>
            <div className="field" style={{ marginBottom: 0 }}><label>Content</label><RichTextEditor value={f.content} onChange={(h) => set("content", h)} resetKey={f.id ?? "new"} placeholder="Write your post…" /></div>
          </div>
          <div className="card">
            <h3>Excerpt</h3>
            <div className="field" style={{ marginBottom: 0 }}><textarea aria-label="Excerpt" rows={3} value={f.excerpt} placeholder="Shown on the blog list. Leave empty to use the start of the post." onChange={(e) => set("excerpt", e.target.value)} {...val.props("excerpt")} /><FieldError k="excerpt" msg={val.err("excerpt")} /></div>
          </div>
          <div className="card">
            <h3>Search engine listing</h3>
            <div className="seourl">{typeof location !== "undefined" ? location.host : ""} › blog › {handle || "post-handle"}</div>
            <div className="field"><label htmlFor="bp-seot">Page title</label><input id="bp-seot" value={f.seoTitle} placeholder={f.title} onChange={(e) => set("seoTitle", e.target.value)} {...val.props("seoTitle")} /><FieldError k="seoTitle" msg={val.err("seoTitle")} /></div>
            <div className="field"><label htmlFor="bp-seod">Meta description</label><textarea id="bp-seod" rows={3} value={f.seoDescription} onChange={(e) => set("seoDescription", e.target.value)} {...val.props("seoDescription")} /><FieldError k="seoDescription" msg={val.err("seoDescription")} /></div>
            <div className="field" style={{ marginBottom: 0 }}><label htmlFor="bp-handle">URL handle</label>
              <div className="prefixed" aria-invalid={val.err("handle") ? true : undefined}><span>/blog/</span><input id="bp-handle" value={handle} onChange={(e) => { setSrv(""); setF((c) => ({ ...c, handle: slug(e.target.value), handleTouched: true })); }} onBlur={() => val.touch("handle")} /></div>
              <FieldError k="handle" msg={val.err("handle")} />
            </div>
          </div>
        </div>
        <aside className="sideform">
          <div className="card">
            <div className="cardhead"><h3>Visibility</h3><Switch checked={f.published} onChange={(v) => set("published", v)} label="Published" /></div>
            <p className="muted" style={{ marginTop: 0 }}>{!f.published ? "Draft: only you can see it." : scheduled ? "Scheduled: goes live on the date below." : "Published: customers can read it."}</p>
            <div className="field" style={{ marginBottom: 0 }}><label htmlFor="bp-date">Publish date (optional)</label><input id="bp-date" type="datetime-local" value={f.publishedAt} onChange={(e) => set("publishedAt", e.target.value)} /><div className="muted">Pick a future date to schedule it. Empty means as soon as it is published.</div></div>
            {f.id && f.published && !scheduled && <p style={{ marginBottom: 0 }}><a className="lnk" href={`/uk/blog/${f.handle}`} target="_blank" rel="noreferrer">View post</a></p>}
          </div>
          <div className="card">
            <h3>Cover image</h3>
            {f.coverImage && <img src={f.coverImage} alt="" style={{ width: "100%", borderRadius: 8, marginBottom: 8 }} />}
            <button disabled={uploading} onClick={() => fileRef.current?.click()}>{uploading ? "Uploading…" : f.coverImage ? "Replace image" : "Upload image"}</button>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={(e) => { const x = e.target.files?.[0]; e.target.value = ""; if (x) upload(x); }} />
            {f.coverImage && <button className="link" style={{ marginLeft: 10 }} onClick={() => set("coverImage", "")}>Remove</button>}
            {upErr && <div className="error" style={{ marginTop: 8 }}>{upErr}</div>}
            <div className="field" style={{ margin: "10px 0 0" }}><label htmlFor="bp-cover">or paste an image address</label><input id="bp-cover" value={f.coverImage} placeholder="https://" onChange={(e) => set("coverImage", e.target.value)} {...val.props("coverImage")} /><FieldError k="coverImage" msg={val.err("coverImage")} /></div>
          </div>
          <div className="card">
            <h3>Details</h3>
            <div className="field"><label htmlFor="bp-author">Author</label><input id="bp-author" value={f.author} onChange={(e) => set("author", e.target.value)} {...val.props("author")} /><FieldError k="author" msg={val.err("author")} /></div>
            <div className="field" style={{ marginBottom: 0 }}><label htmlFor="bp-tags">Tags (comma separated)</label><input id="bp-tags" value={f.tagsText} onChange={(e) => set("tagsText", e.target.value)} /></div>
          </div>
        </aside>
      </div>
      <div className="savebar">
        {f.id && <button className="danger" onClick={remove}>Delete post</button>}
        <span style={{ flex: 1 }} />
        <button onClick={cancel}>Discard</button>
        <button className="primary" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save"}</button>
      </div>
    </>
  );
}

export function BlogPosts() {
  const [q, setQ] = useState("");
  const { data: rows, error, reload } = useApi<Row[]>(`/blog/posts?q=${encodeURIComponent(q)}`);
  const [form, setForm] = useState<Form | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [err, setErr] = useState("");
  useEffect(() => { if (new URLSearchParams(location.search).get("new")) { history.replaceState(null, "", location.pathname); setForm(blank()); } }, []);

  const edit = async (id: string) => {
    try {
      const p = await api<Form & { tags: string[]; publishedAt: string | null }>(`/blog/posts/${id}`);
      setForm({ id: p.id, title: p.title, handle: p.handle, handleTouched: true, content: p.content, excerpt: p.excerpt, author: p.author, tagsText: p.tags.join(", "), coverImage: p.coverImage, published: p.published, publishedAt: toLocalInput(p.publishedAt), seoTitle: p.seoTitle, seoDescription: p.seoDescription });
    } catch (e) { setErr((e as Error).message); }
  };
  const bulk = async (action: "publish" | "unpublish" | "delete") => {
    if (action === "delete" && !confirm(`Delete ${sel.size} post${sel.size === 1 ? "" : "s"}?`)) return;
    try { await api("/blog/posts/bulk", { method: "POST", json: { ids: [...sel], action } }); setSel(new Set()); reload(); } catch (e) { setErr((e as Error).message); }
  };

  if (form) return <Editor key={form.id ?? "new"} initial={form} onDone={() => { setForm(null); reload(); }} />;
  const all = !!rows?.length && rows.every((r) => sel.has(r.id));
  return (
    <>
      <div className="pagehead"><h2>Blog posts</h2><div className="headtools"><button className="primary" onClick={() => setForm(blank())}>Add blog post</button></div></div>
      {(error || err) && <div className="error">{error || err}</div>}
      <div className="card">
        <div className="field"><label htmlFor="bp-q">Search posts</label><input id="bp-q" value={q} placeholder="Title, author or tag" onChange={(e) => setQ(e.target.value)} /></div>
        {sel.size > 0 && <span className="bulkbar"><b>{sel.size} selected</b><button onClick={() => bulk("publish")}>Publish</button><button onClick={() => bulk("unpublish")}>Unpublish</button><button className="danger" onClick={() => bulk("delete")}>Delete</button></span>}
        <div className="tablescroll">
          <table>
            <thead><tr><th style={{ width: 32 }}><input type="checkbox" aria-label="Select all" checked={all} onChange={(e) => setSel(e.target.checked ? new Set(rows?.map((r) => r.id)) : new Set())} /></th><th>Title</th><th>Status</th><th>Author</th><th style={{ textAlign: "right" }}>Date</th></tr></thead>
            <tbody>
              {(rows ?? []).map((r) => (
                <tr key={r.id} className="clickable" onClick={() => edit(r.id)}>
                  <td onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Select ${r.title}`} checked={sel.has(r.id)} onChange={(e) => setSel((c) => { const n = new Set(c); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n; })} /></td>
                  <td><b>{r.title}</b><div className="muted excerpt">{r.excerpt}</div></td>
                  <td><span className={`badge ${state(r) === "Published" ? "ok" : ""}`}>{state(r)}</span></td>
                  <td className="muted">{r.author}</td>
                  <td className="muted" style={{ textAlign: "right", whiteSpace: "nowrap" }}>{when(r.publishedAt ?? r.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows && !rows.length && <p className="muted">{q ? "No posts match your search." : "No posts yet. Write about festivals, rituals and gift ideas to bring in visitors from search."}</p>}
      </div>
    </>
  );
}
