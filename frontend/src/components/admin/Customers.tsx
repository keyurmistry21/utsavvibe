"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, download, money, type CustomerRow, type Market } from "@/lib/api";
import { CustomerDetails } from "./CustomerDetails";
import { ImportCustomers } from "./ImportCustomers";
import { NewCustomerSheet } from "./NewCustomerSheet";
import { Badge, TagList } from "./hooks";

const PAGE = 50;
type ColKey = "email_sub" | "location" | "orders" | "spent" | "email" | "phone" | "first" | "last" | "postcode" | "language" | "id" | "added" | "updated" | "sms" | "whatsapp" | "tax" | "tags";
type Col = { key: ColKey; label: string; right?: boolean; render: (c: CustomerRow) => React.ReactNode };

const sub = (on: boolean, has: boolean) => (!has ? null : <span className={`badge ${on ? "subscribed" : ""}`}>{on ? "Subscribed" : "Not subscribed"}</span>);
const date = (s: string) => new Date(s).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

const COLS: Col[] = [
  { key: "email_sub", label: "Email subscription", render: (c) => sub(c.acceptsEmail, !!c.email) },
  { key: "location", label: "Location", render: (c) => c.location || "" },
  { key: "orders", label: "Orders", right: true, render: (c) => c.orderCount },
  { key: "spent", label: "Amount spent", right: true, render: (c) => Object.entries(c.spent).map(([cur, v]) => money(v, cur)).join(" + ") || "—" },
  { key: "email", label: "Email", render: (c) => c.email ?? "" },
  { key: "phone", label: "Phone", render: (c) => c.phone ?? "" },
  { key: "first", label: "First name", render: (c) => c.firstName },
  { key: "last", label: "Last name", render: (c) => c.lastName },
  { key: "postcode", label: "Postal code", render: (c) => c.postcode },
  { key: "language", label: "Customer language", render: (c) => c.language },
  { key: "id", label: "Id", render: (c) => <span className="muted mono">{c.id}</span> },
  { key: "added", label: "Customer added date", render: (c) => date(c.createdAt) },
  { key: "updated", label: "Date customer updated", render: (c) => date(c.updatedAt) },
  { key: "sms", label: "SMS subscription", render: (c) => sub(c.acceptsSms, !!c.phone) },
  { key: "whatsapp", label: "WhatsApp subscription", render: (c) => sub(c.acceptsWhatsapp, !!c.phone) },
  { key: "tax", label: "Tax exempt", render: (c) => (c.taxExempt ? "Yes" : "No") },
  { key: "tags", label: "Tags", render: (c) => <TagList tags={c.tags} /> },
];
const DEFAULT_VISIBLE: ColKey[] = ["email_sub", "location", "orders", "spent"];
type Sort = "updated" | "created" | "name" | "orders";
const SORTS: [Sort, string][] = [["updated", "Date customer updated"], ["created", "Customer added date"], ["name", "Customer name"], ["orders", "Orders"]];
const FILTERS: [string, string][] = [["all", "All"], ["subscribed", "Email subscribed"], ["unsubscribed", "Not subscribed"], ["with_orders", "Has orders"], ["no_orders", "No orders"], ["tax_exempt", "Tax exempt"]];

type View = { order: ColKey[]; visible: ColKey[]; sort: Sort; dir: "asc" | "desc" };
const KEY = "customers.view.v1";
const defaultView = (): View => ({ order: COLS.map((c) => c.key), visible: DEFAULT_VISIBLE, sort: "updated", dir: "desc" });
function loadView(): View {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as View | null;
    if (!v) return defaultView();
    // tolerate columns added/removed since this view was saved
    const all = COLS.map((c) => c.key);
    const order = [...v.order.filter((k) => all.includes(k)), ...all.filter((k) => !v.order.includes(k))];
    return { order, visible: v.visible.filter((k) => all.includes(k)), sort: SORTS.some(([s]) => s === v.sort) ? v.sort : "updated", dir: v.dir === "asc" ? "asc" : "desc" };
  } catch { return defaultView(); }
}

function ColumnsMenu({ view, setView, onClose }: { view: View; setView: (v: View) => void; onClose: () => void }) {
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
    if (from === to) return;
    const order = [...view.order];
    order.splice(to, 0, order.splice(from, 1)[0]);
    setView({ ...view, order });
  };
  const toggle = (k: ColKey) => setView({ ...view, visible: view.visible.includes(k) ? view.visible.filter((x) => x !== k) : [...view.visible, k] });

  return (
    <div className="colmenu" ref={ref}>
      <div className="sortrow">
        <label htmlFor="sortby">Sort by</label>
        <select id="sortby" value={view.sort} onChange={(e) => setView({ ...view, sort: e.target.value as Sort })}>
          {SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <button className="dirbtn" title={view.dir === "asc" ? "Ascending" : "Descending"} aria-label="Toggle sort direction" onClick={() => setView({ ...view, dir: view.dir === "asc" ? "desc" : "asc" })}>{view.dir === "asc" ? "↑" : "↓"}</button>
      </div>
      <div className="colhead">Columns</div>
      <ul>
        {view.order.map((k, i) => {
          const col = COLS.find((c) => c.key === k)!;
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

export function Customers() {
  const [view, setViewState] = useState<View>(defaultView());
  const [ready, setReady] = useState(false);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [data, setData] = useState<{ items: CustomerRow[]; total: number } | null>(null);
  const [error, setError] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState(false);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [open, setOpen] = useState<CustomerRow | null>(null);
  const [markets, setMarkets] = useState<Market[]>([]);
  const seq = useRef(0);

  useEffect(() => { setViewState(loadView()); setReady(true); api<Market[]>("/markets").then((m) => setMarkets(m.filter((x) => x.active))).catch(() => {}); }, []);
  const setView = (v: View) => { setViewState(v); setPage(0); try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {} };

  const load = useCallback(() => {
    const my = ++seq.current;
    const qs = new URLSearchParams({ q, filter, sort: view.sort, dir: view.dir, limit: String(PAGE), offset: String(page * PAGE) });
    api<{ items: CustomerRow[]; total: number }>(`/customers?${qs}`).then((r) => { if (my === seq.current) { setData(r); setError(""); } }).catch((e) => my === seq.current && setError(e.message));
  }, [q, filter, view.sort, view.dir, page]);

  useEffect(() => { if (!ready) return; const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t); }, [load, ready, q]);
  useEffect(() => { setPage(0); setSel(new Set()); }, [q, filter]);

  const cols = view.order.filter((k) => view.visible.includes(k)).map((k) => COLS.find((c) => c.key === k)!);
  const items = data?.items ?? [];
  const allSel = items.length > 0 && items.every((c) => sel.has(c.id));
  const from = data && data.total ? page * PAGE + 1 : 0;
  const to = data ? Math.min(data.total, page * PAGE + items.length) : 0;
  const toggleAll = () => setSel(allSel ? new Set() : new Set(items.map((c) => c.id)));
  const toggleOne = (id: string) => setSel((cur) => { const n = new Set(cur); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const exportCsv = async () => {
    try {
      const qs = sel.size ? `ids=${[...sel].join(",")}` : `q=${encodeURIComponent(q)}&filter=${filter}`;
      await download(`/customers/export?${qs}`, "customers.csv");
    } catch (e) { setError((e as Error).message); }
  };

  return (
    <>
      <div className="pagehead">
        <h2 className="withicon">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 20v-1a4 4 0 00-4-4H8a4 4 0 00-4 4v1M10 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7M20 20v-1a4 4 0 00-3-3.9M16 4.2a3.5 3.5 0 010 6.6" /></svg>
          Customers
        </h2>
        <div className="headtools">
          <button onClick={exportCsv}>{sel.size ? `Export ${sel.size} selected` : "Export"}</button>
          <button onClick={() => setImporting(true)}>Import</button>
          <button className="primary" onClick={() => setAdding(true)}>Add customer</button>
        </div>
      </div>

      <div className="card custlistcard">
        <div className="custtools">
          <div className="searchfield grow">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3" /></svg>
            <input placeholder="Search customers" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="colwrap">
            <button className="colbtn iconbtn" aria-label="Sort and choose columns" title="Sort and columns" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16M15 4v16" /></svg>
            </button>
            {menu && <ColumnsMenu view={view} setView={setView} onClose={() => setMenu(false)} />}
          </div>
        </div>
        <div className="filterchips">
          {FILTERS.map(([k, l]) => <button key={k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>{l}</button>)}
        </div>
        {error && <div className="error">{error}</div>}

        <div className="tablescroll">
          <table className="custtable">
            <thead>
              {sel.size > 0 ? (
                <tr className="selbar"><th><input type="checkbox" checked={allSel} onChange={toggleAll} aria-label="Select all" /></th><th colSpan={cols.length + 1}>{sel.size} selected <button className="link" onClick={() => setSel(new Set())}>Clear</button></th></tr>
              ) : (
                <tr>
                  <th className="chk"><input type="checkbox" checked={allSel} onChange={toggleAll} aria-label="Select all" /></th>
                  <th>Customer name</th>
                  {cols.map((c) => <th key={c.key} className={c.right ? "r" : ""}>{c.label}</th>)}
                </tr>
              )}
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} className={sel.has(c.id) ? "selected" : ""}>
                  <td className="chk"><input type="checkbox" checked={sel.has(c.id)} onChange={() => toggleOne(c.id)} aria-label={`Select ${c.name || c.email}`} /></td>
                  <td><button className="link namebtn" onClick={() => setOpen(c)}>{c.name || c.email || c.phone || "—"}</button></td>
                  {cols.map((col) => <td key={col.key} className={col.right ? "r" : ""}>{col.render(c)}</td>)}
                </tr>
              ))}
              {data && !items.length && <tr><td colSpan={cols.length + 2} className="muted emptyrow">{q || filter !== "all" ? "No customers match your search or filter." : "No customers yet. Add one, or import a CSV."}</td></tr>}
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

      {adding && markets.length > 0 && <NewCustomerSheet markets={markets} onCreated={() => { setAdding(false); load(); }} onClose={() => setAdding(false)} />}
      {importing && <ImportCustomers onDone={load} onClose={() => setImporting(false)} />}
      {open && <CustomerDetails customer={open} onSaved={() => { setOpen(null); load(); }} onClose={() => setOpen(null)} />}
    </>
  );
}
