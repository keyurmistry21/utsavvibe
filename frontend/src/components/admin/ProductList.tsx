"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, download, money, type ProductRow } from "@/lib/api";
import { ColumnsMenu, loadView, saveView, type ViewState } from "./ColumnsMenu";
import { Badge, TagList } from "./hooks";
import { Select } from "../Select";
import { useAdminMarket } from "@/lib/adminMarket";
import { SearchField } from "./SearchField";

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

export function ProductList({ onAdd, onEdit }: { onAdd: () => void; onEdit: (handle: string) => void }) {
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

  const { market } = useAdminMarket();
  const loadStats = useCallback(() => { api<Stats>(`/products/stats${market ? `?market=${market}` : ""}`).then(setStats).catch(() => {}); }, [market]);
  const load = useCallback(() => {
    const my = ++seq.current;
    const qs = new URLSearchParams({ q, status, filter: filter === "any" ? "all" : filter, sort: view.sort, dir: view.dir, limit: String(PAGE), offset: String(page * PAGE), ...(market ? { market } : {}) });
    api<{ items: ProductRow[]; total: number }>(`/products/list?${qs}`).then((r) => { if (my === seq.current) { setData(r); setError(""); } }).catch((e) => my === seq.current && setError(e.message));
  }, [q, status, filter, view.sort, view.dir, page, market]);

  useEffect(() => { if (!ready) return; const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t); }, [load, ready, q]);
  useEffect(() => { loadStats(); }, [loadStats]);
  useEffect(() => { setPage(0); setSel(new Set()); }, [q, status, filter, market]);

  const cols = view.order.filter((k) => view.visible.includes(k)).map((k) => COLS.find((c) => c.key === k)!);
  // with a working market selected only that market's price is shown
  const items = (data?.items ?? []).map((p) => (market ? { ...p, prices: Object.fromEntries(Object.entries(p.prices).filter(([c]) => c === market)) } : p));
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

  const CIRC = 2 * Math.PI * 48;
  const ringParts = stats ? ([["ok", stats.active], ["low", stats.draft], ["arch", stats.archived]] as const).filter(([, n]) => n > 0) : [];
  let off = 0;
  const ringSegs = ringParts.map(([cls, n]) => { const len = (n / Math.max(1, stats!.total)) * CIRC; const g = { cls, len: Math.max(0, len - 3), off }; off += len; return g; });
  const duplicate = async (id: string, title: string) => {
    if (!confirm(`Make a copy of "${title}"? The copy is saved as a draft with no stock, SKUs or barcodes.`)) return;
    try { const r = await api<{ handle: string }>(`/products/${id}/duplicate`, { method: "POST", toast: "Product duplicated." }); onEdit(r.handle); } catch (e) { setError((e as Error).message); }
  };
  // status, stock, markets and price have their own place in the row; type and vendor are in the sub line; empty ones are not shown
  const extra = cols.filter((c) => !["status", "inventory", "markets", "price", "type", "vendor"].includes(c.key));
  // one fixed column per market so the prices line up from row to row
  const mkCodes = [...new Set(items.flatMap((p) => Object.keys(p.prices)))].sort();
  const hasValue = (c: Col, p: ProductRow) => (c.key === "tags" ? p.tags.length > 0 : true);

  return (
    <>
      <div className="pagehead">
        <h2 className="withicon">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12l9-9h8v8l-9 9zM15.5 8.5h.01" /></svg>
          Products
        </h2>
        <div className="headtools">
          <button onClick={exportCsv}>{sel.size ? `Export ${sel.size} selected` : "Export"}</button>
          <Link className="btn-link" href="/admin/products/import">Import</Link>
          <Link className="btn-link" href="/admin/products/scan">Scan stock</Link>
          <Link className="btn-link" href={sel.size ? `/admin/products/labels?ids=${[...sel].join(",")}` : "/admin/products/labels"}>{sel.size ? `Print labels (${sel.size})` : "Print labels"}</Link>
          <button className="primary" onClick={onAdd}>Add product</button>
        </div>
      </div>

      <div className="iv">
        <section className="iv-hero pl-hero" aria-label="Catalogue summary">
          <div className="iv-ring" role="img" aria-label={stats ? `${stats.active} active, ${stats.draft} draft, ${stats.archived} archived` : "Loading"}>
            <svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="48" className="iv-ring-bg" />{ringSegs.map((g) => <circle key={g.cls} cx="60" cy="60" r="48" className={`iv-ring-seg ${g.cls}`} strokeDasharray={`${g.len} ${CIRC - g.len}`} strokeDashoffset={-g.off} />)}</svg>
            <div className="iv-ring-mid"><b>{stats?.total ?? "–"}</b><span>products</span></div>
          </div>
          <div className="iv-stats pl-stats">
            <button className={`iv-stat ok ${status === "active" ? "on" : ""}`} onClick={() => setStatus(status === "active" ? "all" : "active")}><i /><b>{stats?.active ?? "–"}</b><span>Active on the store</span></button>
            <button className={`iv-stat low ${status === "draft" ? "on" : ""}`} onClick={() => setStatus(status === "draft" ? "all" : "draft")}><i /><b>{stats?.draft ?? "–"}</b><span>Drafts</span></button>
            <button className={`iv-stat arch ${status === "archived" ? "on" : ""}`} onClick={() => setStatus(status === "archived" ? "all" : "archived")}><i /><b>{stats?.archived ?? "–"}</b><span>Archived</span></button>
            <button className={`iv-stat out ${filter === "out_of_stock" ? "on" : ""}`} onClick={() => setFilter(filter === "out_of_stock" ? "any" : "out_of_stock")}><i /><b>{stats?.outOfStock ?? "–"}</b><span>Out of stock</span></button>
          </div>
        </section>
      </div>

      <div className="pl-tools">
        <SearchField className="grow" placeholder="Search products, tags, SKUs" value={q} onChange={setQ} />
        <div className="inv-chips" role="group" aria-label="Status">{VIEWS.map(([k, l]) => <button key={k} className={status === k ? "on" : ""} onClick={() => setStatus(k)}>{l}</button>)}</div>
        <div className="inv-chips" role="group" aria-label="Stock">{FILTERS.map(([k, l]) => <button key={k} className={(filter === "any" ? "all" : filter) === k ? "on" : ""} onClick={() => setFilter(k === "all" ? "any" : k)}>{l}</button>)}</div>
        <div className="colwrap">
          <button className="colbtn iconbtn" aria-label="Sort and choose details" title="Sort and details" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M7 12h10M10 17h4" /></svg>
          </button>
          {menu && <ColumnsMenu columns={COLS} sorts={SORTS} view={view} setView={setView} onClose={() => setMenu(false)} />}
        </div>
      </div>
      {msg && <div className="okmsg" style={{ margin: "0 0 10px" }}>{msg}</div>}
      {error && <div className="error" style={{ margin: "0 0 10px" }}>{error}</div>}

      {sel.size > 0 && (
        <div className="pl-bulk" role="toolbar" aria-label="Bulk actions">
          <label><input type="checkbox" checked={allSel} onChange={toggleAll} aria-label="Select all" /> {sel.size} selected</label>
          <button onClick={() => bulk("activate")}>Set as active</button>
          <button onClick={() => bulk("draft")}>Set as draft</button>
          <button onClick={() => bulk("archive")}>Archive</button>
          <button className="danger" onClick={() => bulk("delete")}>Delete</button>
          <button className="link" onClick={() => setSel(new Set())}>Clear</button>
        </div>
      )}

      <div className="pl-list">
        {items.map((p) => {
          const stock = p.inventory <= 0 ? "out" : p.inventory <= 5 ? "low" : "ok";
          return (
            <div key={p.id} className={`pl-row ${stock} ${sel.has(p.id) ? "sel" : ""}`}>
              <input type="checkbox" className="pl-chk" checked={sel.has(p.id)} onChange={() => toggleOne(p.id)} aria-label={`Select ${p.title}`} />
              <button className="pl-open" onClick={() => onEdit(p.handle)} aria-label={`Edit ${p.title}`}>
                <span className="iv-thumb">{p.thumbUrl ? <img src={p.thumbUrl} alt="" /> : <span aria-hidden>📦</span>}</span>
                <span className="pl-main">
                  <span className="pl-title"><b>{p.title}</b>{cols.some((c) => c.key === "status") && <Badge value={p.status} />}</span>
                  <span className="pl-sub">{[p.variantCount > 1 ? `${p.variantCount} variants` : "", p.productType, p.vendor].filter(Boolean).join(" · ") || "Single item"}</span>
                  {extra.some((c) => hasValue(c, p)) && <span className="pl-extra">{extra.filter((c) => hasValue(c, p)).map((c) => <span key={c.key}><i>{c.label}</i>{c.render(p)}</span>)}</span>}
                </span>
                <span className="pl-mk" style={{ ["--n" as string]: Math.max(1, mkCodes.length) }}>
                  {mkCodes.length ? mkCodes.map((c) => { const x = p.prices[c]; return x ? <span key={c} className="pl-price"><i>{c}</i>{money(x.min, x.currency)}</span> : <span key={c} className="pl-price none">–</span>; }) : (p.markets.length ? p.markets.map((m) => <span key={m} className="chip">{m}</span>) : <span className="muted">Not on sale</span>)}
                </span>
                <span className={`iv-total ${stock}`}><b>{p.inventory}</b><small>{stock === "out" ? "sold out" : stock === "low" ? "running low" : "in stock"}</small></span>
                <svg className="iv-go" viewBox="0 0 24 24" aria-hidden><path d="M9 6l6 6-6 6" /></svg>
              </button>
              <button className="pl-dup" title="Duplicate" aria-label={`Duplicate ${p.title}`} onClick={() => duplicate(p.id, p.title)}><svg viewBox="0 0 24 24" aria-hidden><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></svg></button>
            </div>
          );
        })}
        {data && !items.length && <div className="iv-empty"><div aria-hidden>🛍️</div><b>{q || status !== "all" || filter !== "any" ? "No products match" : "No products yet"}</b><span>{q || status !== "all" || filter !== "any" ? "Try another search or filter." : "Add your first product to get started."}</span></div>}
        {!data && !error && <div className="iv-empty"><span>Loading…</span></div>}
      </div>

      {!!data?.total && (
        <div className="pager">
          <button aria-label="Previous page" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>‹</button>
          <span>{from}–{to}</span>
          <button aria-label="Next page" disabled={to >= data.total} onClick={() => setPage((p) => p + 1)}>›</button>
          <span className="muted">of {data.total}</span>
        </div>
      )}
    </>
  );
}
