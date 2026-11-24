"use client";

import { useRef, useState } from "react";
import { api } from "@/lib/api";
import { useCan } from "@/lib/perms";
import { useApi } from "./hooks";
import { CopyBox } from "./CopyBox";

type FileRow = { id: string; name: string; ext: string; mime: string; size: number; alt: string; createdAt: string; createdBy: string; url: string; isImage: boolean };

const size = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

// Upload an image or PDF once, copy its address, paste it into a page, blog post or email.
export function Files() {
  const { can } = useCan();
  const manage = can("online_store.manage");
  const [q, setQ] = useState("");
  const { data, error, reload } = useApi<FileRow[]>(`/files?q=${encodeURIComponent(q)}`);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  const upload = async (files: FileList | File[]) => {
    setErr(""); setBusy(true);
    const errors: string[] = [];
    for (const f of Array.from(files)) {
      try {
        // always sent as octet-stream so the JSON body parser leaves the file alone
        const res = await fetch("/api/admin/files", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/octet-stream", "x-file-name": encodeURIComponent(f.name) }, body: f });
        if (res.status === 401) window.dispatchEvent(new Event("admin:unauthorized"));
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.error ?? res.statusText);
      } catch (e) { errors.push(`${f.name}: ${(e as Error).message}`); }
    }
    setBusy(false); reload();
    if (errors.length) setErr(errors.join(" · "));
  };
  const remove = async (f: FileRow) => {
    if (!window.confirm(`Delete ${f.name}? Pages that link to it will show a broken file.`)) return;
    try { await api(`/files/${f.id}`, { method: "DELETE" }); reload(); } catch (e) { setErr((e as Error).message); }
  };

  return (
    <>
      <div className="pagehead">
        <div><h2>Files</h2><div className="muted">Upload images and PDFs here, then copy the address to use in pages, blog posts and emails.</div></div>
        {manage && <><input ref={input} type="file" multiple hidden accept=".jpg,.jpeg,.png,.webp,.gif,.pdf,.txt,.csv,.json,.mp4" onChange={(e) => { if (e.target.files?.length) upload(e.target.files); e.target.value = ""; }} /><button className="primary" disabled={busy} onClick={() => input.current?.click()}>{busy ? "Uploading…" : "Upload files"}</button></>}
      </div>
      {err && <div className="error">{err}</div>}
      {error && <div className="error">{error}</div>}
      <div className="card">
        <div className="field"><label htmlFor="fl-q">Search files</label><input id="fl-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="File name" /></div>
        {manage && (
          <div className="filedrop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files.length) upload(e.dataTransfer.files); }}>
            Drop files here, or use <b>Upload files</b>. JPG, PNG, WebP, GIF, PDF, TXT, CSV, JSON, MP4 up to 20 MB.
          </div>
        )}
        <table>
          <thead><tr><th>File</th><th>Added</th><th className="r">Size</th><th /></tr></thead>
          <tbody>
            {data?.map((f) => (
              <tr key={f.id}>
                <td>
                  <div className="invprod">
                    {f.isImage ? <img src={f.url} alt={f.alt} width={40} height={40} /> : <span className="invthumb filetype">{f.ext.toUpperCase()}</span>}
                    <span><b>{f.name}</b><span className="muted" style={{ display: "block" }}>{f.createdBy}</span></span>
                  </div>
                  {open === f.id && <div style={{ marginTop: 8, maxWidth: 520 }}><CopyBox label="File address" value={`${origin}${f.url}`} /></div>}
                </td>
                <td>{new Date(f.createdAt).toLocaleDateString()}</td>
                <td className="r">{size(f.size)}</td>
                <td className="r">
                  <button className="link" onClick={() => setOpen(open === f.id ? null : f.id)}>{open === f.id ? "Hide link" : "Copy link"}</button>{" "}
                  <a className="link" href={f.url} target="_blank" rel="noreferrer">Open</a>
                  {manage && <>{" "}<button className="link" onClick={() => remove(f)}>Delete</button></>}
                </td>
              </tr>
            ))}
            {data && !data.length && <tr><td colSpan={4} className="muted">No files yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
