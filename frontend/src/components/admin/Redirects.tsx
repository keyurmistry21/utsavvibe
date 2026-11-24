"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useApi } from "./hooks";

type Row = { id: string; fromPath: string; toPath: string; createdAt: string };

// Old URL -> new URL, served as a 301 so Google moves the ranking of the old Shopify pages to the new ones.
export function Redirects() {
  const { data, error, reload } = useApi<Row[]>("/redirects");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [bulk, setBulk] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const add = async () => {
    setErr(""); setMsg("");
    try { await api("/redirects", { method: "POST", json: { from, to } }); setFrom(""); setTo(""); reload(); }
    catch (e) { setErr((e as Error).message === "validation" ? "Enter both addresses" : (e as Error).message); }
  };
  const importRows = async () => {
    setErr(""); setMsg("");
    // one pair per line: old,new (comma, tab or semicolon). A header row from Shopify's export is skipped.
    const rows = bulk.split(/\r?\n/).map((l) => l.split(/[,\t;]/).map((x) => x.trim().replace(/^"|"$/g, ""))).filter((c) => c.length >= 2 && c[0] && c[1] && !/^redirect from$/i.test(c[0])).map((c) => ({ from: c[0], to: c[1] }));
    if (!rows.length) return setErr("Paste one redirect per line: old address, new address");
    try {
      const r = await api<{ saved: number; skippedCount: number; skipped: string[] }>("/redirects/bulk", { method: "POST", json: { rows } });
      setMsg(`${r.saved} saved${r.skippedCount ? `, ${r.skippedCount} skipped (${r.skipped.slice(0, 3).join(", ")}${r.skippedCount > 3 ? "…" : ""})` : ""}.`);
      setBulk(""); reload();
    } catch (e) { setErr((e as Error).message); }
  };
  const remove = async (id: string) => { await api(`/redirects/${id}`, { method: "DELETE" }).catch(() => {}); reload(); };

  return (
    <>
      <div className="pagehead"><div><h2>Redirects</h2><div className="muted">Send visitors and Google from an old address to the right page on this site (a 301 redirect).</div></div></div>
      <div className="notice" style={{ marginBottom: 16 }}>
        Standard Shopify addresses already redirect on their own: <code>/products/…</code>, <code>/collections/…</code>, <code>/pages/…</code>, <code>/blogs/…/…</code>, <code>/policies/…</code> and <code>/cart</code> go to the same page in the visitor&apos;s market. Add rows below only for addresses that changed.
      </div>
      {err && <div className="error">{err}</div>}
      {msg && <div className="okmsg">{msg}</div>}
      {error && <div className="error">{error}</div>}
      <div className="card">
        <h3>Add a redirect</h3>
        <div className="row">
          <div className="field"><label htmlFor="rd-from">Old address</label><input id="rd-from" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="/products/old-ganesha" /></div>
          <div className="field"><label htmlFor="rd-to">Send to</label><input id="rd-to" value={to} onChange={(e) => setTo(e.target.value)} placeholder="/uk/products/brass-ganesha-idol" onKeyDown={(e) => e.key === "Enter" && add()} /></div>
          <button className="primary" onClick={add}>Add</button>
        </div>
        <details style={{ marginTop: 12 }}>
          <summary>Import many (paste from Shopify&apos;s URL redirects export or a spreadsheet)</summary>
          <textarea rows={6} value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder={"/old-page,/uk/pages/about\n/products/old,/uk/products/new"} style={{ marginTop: 8 }} />
          <div style={{ marginTop: 8 }}><button onClick={importRows}>Import</button></div>
        </details>
      </div>
      <div className="card">
        <table>
          <thead><tr><th>Old address</th><th>Sent to</th><th /></tr></thead>
          <tbody>
            {data?.map((r) => <tr key={r.id}><td><code>{r.fromPath}</code></td><td><code>{r.toPath}</code></td><td className="r"><button className="link" onClick={() => remove(r.id)}>Delete</button></td></tr>)}
            {data && !data.length && <tr><td colSpan={3}>No custom redirects yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
