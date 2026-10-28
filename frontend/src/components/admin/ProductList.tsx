"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, download, money, type ProductRow } from "@/lib/api";
import { ColumnsMenu, loadView, saveView, type ViewState } from "./ColumnsMenu";
import { Badge, TagList } from "./hooks";

const PAGE = 50;
type ColKey = "status" | "inventory" | "markets" | "price" | "type" | "vendor" | "tags" | "variants" | "updated" | "created";
type Col = { key: ColKey; label: string; right?: boolean; render: (p: ProductRow) => React.ReactNode };
type Sort = "updated" | "created" | "title";
const date = (s: string) => new Date(s).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

const COLS: Col[] = [
  { key: "status", label: "Status", render: (p) => <Badge value={p.status} /> },
  {
    key: "inventory", label: "Inventory",
    render: (p) => (
      <span>
        <span className={p.inventory <= 0 ? "stock-out" : p.inventory <= 5 ? "stock-low" : ""}>{p.inventory} in stock</span>
        {p.variantCount > 1 && <span className="muted"> for {p.variantCount} variants</span>}
      </span>
    ),
  },
  { key: "markets", label: "Markets", render: (p) => (p.markets.length ? p.markets.map((m) => <span key={m} className="chip">{m}</span>) : <span className="muted">None</span>) },
  { key: "price", label: "Price (from)", render: (p) => (Object.keys(p.prices).length ? Object.entries(p.prices).map(([c, x]) => <div key={c}>{money(x.min, x.currency)}</div>) : <span className="muted">—</span>) },
  { key: "type", label: "Product type", render: (p) => p.productType || <span className="muted">—</span> },
  { key: "vendor", label: "Vendor", render: (p) => p.vendor || <span className="muted">—</span> },
  { key: "tags", label: "Tags", render: (p) => <TagList tags={p.tags} /> },
  { key: "variants", label: "Variants", right: true, render: (p) => p.variantCount },
  { key: "updated", label: "Date updated", render: (p) => date(p.updatedAt) },
  { key: "created", label: "Date added", render: (p) => date(p.createdAt) },
];
const DEFAULT_VISIBLE: ColKey[] = ["status", "inventory", "markets", "type", "vendor"];
const SORTS: [Sort, string][] = [["updated", "Date updated"], ["created", "Date added"], ["title", "Product title"]];
const KEY = "products.view.v1";
const VIEWS: [string, string][] = [["all", "All"], ["active", "Active"], ["draft", "Draft"], ["archived", "Archived"]];
const FILTERS: [string, string][] = [["all", "Any stock"], ["out_of_stock", "Out of stock"], ["low_stock", "Low stock"]];

type View = ViewState<ColKey, Sort>;
type Stats = { total: number; active: number; draft: number; archived: number; outOfStock: number };

export function ProductList({ onAdd, onEdit }: { onAdd: () => void; onEdit: (id: string) => void }) {
  const [view, setViewState] = useState<View>({ order: COLS.map((c) => c.key), visible: DEFAULT_VISIBLE, sort: "updated", dir: "desc" });
  const [ready, setReady] = useState(false);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [filter, setFilter] = useState("any");
  const [page, setPage] = useState(0);
  const [data, setData] = useState<{ items: ProductRow[]; total: number } | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState(false);
  const seq = useRef(0);

  useEffect(() => { setViewState(loadView(KEY, COLS.map((c) => c.key), DEFAULT_VISIBLE, SORTS.map(([k]) => k), "updated" as Sort)); setReady(true); }, []);
  const setView = (v: View) => { setViewState(v); setPage(0); saveView(KEY, v); };

  const loadStats = useCallback(() => { api<Stats>("/products/stats").then(setStats).catch(() => {}); }, []);
  const load = useCallback(() => {
    const my = ++seq.current;
    const qs = new URLSearchParams({ q, status, filter: filter === "any" ? "all" : filter, sort: view.sort, dir: view.dir, limit: String(PAGE), offset: String(page * PAGE) });
    api<{ items: ProductRow[]; total: number }>(`/products/list?${qs}`).then((r) => { if (my === seq.current) { setData(r); setError(""); } }).catch((e) => my === seq.current && setError(e.message));
  }, [q, status, filter, view.sort, view.dir, page]);

  useEffect(() => { if (!ready) return; const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t); }, [load, ready, q]);
  useEffect(() => { loadStats(); }, [loadStats]);
  useEffect(() => { setPage(0); setSel(new Set()); }, [q, status, filter]);

  const cols = view.order.filter((k) => view.visible.includes(k)).map((k) => COLS.find((c) => c.key === k)!);
  const items = data?.items ?? [];
  const allSel = items.length > 0 && items.every((p) => sel.has(p.id));
  const from = data && data.total ? page * PAGE + 1 : 0;
  const to = data ? Math.min(data.total, page * PAGE + items.length) : 0;
  const toggleAll = () => setSel(allSel ? new Set() : new Set(items.map((p) => p.id)));
  const toggleOne = (id: string) => setSel((cur) => { const n = new Set(cur); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const refresh = () => { load(); loadStats(); };

  const bulk = async (action: "activate" | "draft" | "archive" | "delete") => {
    const n = sel.size;
    if (action === "delete" && !confirm(`Delete ${n} product${n === 1 ? "" : "s"}? Products that have been ordered are archived instead.`)) return;
    setError(""); setMsg("");
    try {
      const r = await api<{ updated: number; deleted: number; archived: number }>("/products/bulk", { method: "POST", json: { ids: [...sel], action } });
      setMsg(action === "delete" ? `${r.deleted} deleted${r.archived ? `, ${r.archived} archived (they have orders)` : ""}.` : `${r.updated} product${r.updated === 1 ? "" : "s"} updated.`);
      setSel(new Set()); refresh();
    } catch (e) { setError((e as Error).message); }
  };
  const exportCsv = async () => {
    try { await download(sel.size ? `/products/export?ids=${[...sel].join(",")}` : `/products/export?q=${encodeURIComponent(q)}&status=${status}&filter=${filter === "any" ? "all" : filter}`, "products.csv"); }
    catch (e) { setError((e as Error).message); }
  };

  return (
    <>
      <div className="pagehead">
        <h2 className="withicon">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12l9-9h8v8l-9 9zM15.5 8.5h.01" /></svg>
          Products
        </h2>
        <div className="headtools">
          <button onClick={exportCsv}>{sel.size ? `Export ${sel.size} selected` : "Export"}</button>
          <button className="primary" onClick={onAdd}>Add product</button>
        </div>
      </div>

      {stats && (
        <div className="statstrip">
          <div><span>Products</span><b>{stats.total}</b></div>
          <div><span>Active</span><b>{stats.active}</b></div>
          <div><span>Draft</span><b>{stats.draft}</b></div>
          <div><span>Out of stock</span><b className={stats.outOfStock ? "stock-out" : ""}>{stats.outOfStock}</b></div>
        </div>
      )}

      <div className="card custlistcard">
        <div className="custtools">
          <select className="viewselect" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Product view">
            {VIEWS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <div className="searchfield grow">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3" /></svg>
            <input placeholder="Search and filter" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="colwrap">
            <button className="colbtn iconbtn" aria-label="Sort and choose columns" title="Sort and columns" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16M15 4v16" /></svg>
            </button>
            {menu && <ColumnsMenu columns={COLS} sorts={SORTS} view={view} setView={setView} onClose={() => setMenu(false)} />}
          </div>
        </div>
        <div className="filterchips">
          {FILTERS.map(([k, l]) => <button key={k} className={(filter === "any" ? "all" : filter) === k ? "on" : ""} onClick={() => setFilter(k === "all" ? "any" : k)}>{l}</button>)}
        </div>
        {msg && <div className="okmsg" style={{ margin: "8px 12px" }}>{msg}</div>}
        {error && <div className="error" style={{ margin: "8px 12px" }}>{error}</div>}

        <div className="tablescroll">
          <table className="custtable">
            <thead>
              {sel.size > 0 ? (
                <tr className="selbar">
                  <th className="chk"><input type="checkbox" checked={allSel} onChange={toggleAll} aria-label="Select all" /></th>
                  <th colSpan={cols.length + 1}>
                    <span className="bulkbar">
                      {sel.size} selected
                      <button onClick={() => bulk("activate")}>Set as active</button>
                      <button onClick={() => bulk("draft")}>Set as draft</button>
                      <button onClick={() => bulk("archive")}>Archive</button>
                      <button className="danger" onClick={() => bulk("delete")}>Delete</button>
                      <button className="link" onClick={() => setSel(new Set())}>Clear</button>
                    </span>
                  </th>
                </tr>
              ) : (
                <tr>
                  <th className="chk"><input type="checkbox" checked={allSel} onChange={toggleAll} aria-label="Select all" /></th>
                  <th>Product</th>
                  {cols.map((c) => <th key={c.key} className={c.right ? "r" : ""}>{c.label}</th>)}
                </tr>
              )}
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id} className={sel.has(p.id) ? "selected" : ""}>
                  <td className="chk"><input type="checkbox" checked={sel.has(p.id)} onChange={() => toggleOne(p.id)} aria-label={`Select ${p.title}`} /></td>
                  <td>
                    <div className="prodcell">
                      {p.thumbUrl ? <img className="listthumb" src={p.thumbUrl} alt="" /> : <span className="listthumb noimg" />}
                      <button className="link namebtn" onClick={() => onEdit(p.id)}>{p.title}</button>
                    </div>
                  </td>
                  {cols.map((c) => <td key={c.key} className={c.right ? "r" : ""}>{c.render(p)}</td>)}
                </tr>
              ))}
              {data && !items.length && <tr><td colSpan={cols.length + 2} className="muted emptyrow">{q || status !== "all" || filter !== "any" ? "No products match your search or filters." : "No products yet. Add your first product."}</td></tr>}
              {!data && !error && <tr><td colSpan={cols.length + 2} className="muted emptyrow">Loading…</td></tr>}
            </tbody>
          </table>
        </div>

        {!!data?.total && (
          <div className="pager">
            <button aria-label="Previous page" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>‹</button>
            <span>{from}–{to}</span>
            <button aria-label="Next page" disabled={to >= data.total} onClick={() => setPage((p) => p + 1)}>›</button>
            <span className="muted">of {data.total}</span>
          </div>
        )}
      </div>
    </>
  );
}
