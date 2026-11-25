"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, download, money, type CustomerRow, type Market } from "@/lib/api";
import { CustomerDetails } from "./CustomerDetails";
import { ImportCustomers } from "./ImportCustomers";
import { NewCustomerSheet } from "./NewCustomerSheet";
import { Badge, TagList } from "./hooks";
import { ColumnsMenu, loadView, saveView, type ViewState } from "./ColumnsMenu";
import { SearchField } from "./SearchField";
import { Banner } from "./Banner";

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

type View = ViewState<ColKey, Sort>;
const KEY = "customers.view.v1";
const SORT_KEYS = SORTS.map(([k]) => k);
const defaultView = (): View => ({ order: COLS.map((c) => c.key), visible: DEFAULT_VISIBLE, sort: "updated", dir: "desc" });
const loadCustomerView = (): View => loadView(KEY, COLS.map((c) => c.key), DEFAULT_VISIBLE, SORT_KEYS, "updated" as Sort);

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

  useEffect(() => { setViewState(loadCustomerView()); setReady(true); api<Market[]>("/markets").then((m) => setMarkets(m.filter((x) => x.active))).catch(() => {}); }, []);
  const setView = (v: View) => { setViewState(v); setPage(0); saveView(KEY, v); };
  // totals for the banner (they do not change with the search box)
  const [counts, setCounts] = useState<Record<string, number>>({});
  const loadCounts = useCallback(() => {
    for (const k of ["all", "subscribed", "with_orders", "no_orders"]) api<{ total: number }>(`/customers?filter=${k}&limit=1&offset=0`).then((r) => setCounts((c) => ({ ...c, [k]: r.total }))).catch(() => {});
  }, []);
  useEffect(() => { loadCounts(); }, [loadCounts]);

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

  if (adding && markets.length > 0) return <NewCustomerSheet markets={markets} backLabel="Customers" onCreated={() => { setAdding(false); load(); }} onClose={() => setAdding(false)} />;

  const core = ["email_sub", "location", "orders", "spent", "email", "first", "last"];
  const extra = cols.filter((c) => !core.includes(c.key));
  const hue = (t: string) => [...t].reduce((a, c) => a + c.charCodeAt(0) * 13, 0) % 360;
  const initials = (c: CustomerRow) => ((c.name || c.email || "?").split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join("") || "?").toUpperCase();

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

      <Banner title="Customers summary" ring={{ value: counts.all ?? "–", label: "customers", segs: [{ cls: "ok", n: counts.with_orders ?? 0 }, { cls: "arch", n: counts.no_orders ?? 0 }] }} stats={[
        { label: "Have ordered", value: counts.with_orders ?? "–", tone: "ok", on: filter === "with_orders", onClick: () => setFilter(filter === "with_orders" ? "all" : "with_orders") },
        { label: "Not ordered yet", value: counts.no_orders ?? "–", tone: "arch", on: filter === "no_orders", onClick: () => setFilter(filter === "no_orders" ? "all" : "no_orders") },
        { label: "Email subscribed", value: counts.subscribed ?? "–", tone: "low", on: filter === "subscribed", onClick: () => setFilter(filter === "subscribed" ? "all" : "subscribed") },
      ]} />

      <div className="xr-tools">
        <SearchField className="grow" placeholder="Search customers" value={q} onChange={setQ} />
        <div className="inv-chips" role="group" aria-label="Filter">{FILTERS.map(([k, l]) => <button key={k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>{l}</button>)}</div>
        <div className="colwrap">
          <button className="colbtn iconbtn" aria-label="Sort and choose details" title="Sort and details" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M7 12h10M10 17h4" /></svg>
          </button>
          {menu && <ColumnsMenu columns={COLS} sorts={SORTS} view={view} setView={setView} onClose={() => setMenu(false)} />}
        </div>
      </div>
      {error && <div className="error">{error}</div>}

      {sel.size > 0 && (
        <div className="pl-bulk" role="toolbar" aria-label="Selected customers"><label><input type="checkbox" checked={allSel} onChange={toggleAll} aria-label="Select all" /> {sel.size} selected</label><button onClick={exportCsv}>Export selected</button><button className="link" onClick={() => setSel(new Set())}>Clear</button></div>
      )}

      <div className="xr-list">
        {items.map((c) => (
          <div key={c.id} className={`xr ${c.orderCount > 0 ? "" : "arch"} ${sel.has(c.id) ? "sel" : ""}`} style={{ ["--cols" as string]: "22px 48px minmax(0,1.5fr) minmax(0,1fr) 80px 130px auto" }}>
            <input type="checkbox" checked={sel.has(c.id)} onChange={() => toggleOne(c.id)} aria-label={`Select ${c.name || c.email}`} />
            <span className="xr-av" style={{ background: `linear-gradient(135deg,hsl(${hue(c.name || c.email || "x")} 70% 55%),hsl(${(hue(c.name || c.email || "x") + 50) % 360} 65% 42%))` }}>{initials(c)}</span>
            <button className="xr-main xr-open" onClick={() => setOpen(c)} aria-label={`Open ${c.name || c.email}`}>
              <b>{c.name || c.email || c.phone || "No name"}</b>
              <small>{[c.name ? c.email : "", c.phone].filter(Boolean).join(" · ") || "No contact details"}</small>
              {extra.length > 0 && <span className="pl-extra">{extra.map((col) => { const v = col.render(c); return v ? <span key={col.key}><i>{col.label}</i>{v}</span> : null; })}</span>}
            </button>
            <span className="xr-sub hide-s">{c.location || "No address"}</span>
            <span className="xr-num hide-s" title="Orders">{c.orderCount}<small className="xr-unit"> orders</small></span>
            <span className="xr-num hide-s">{Object.entries(c.spent).map(([cur, v]) => money(v, cur)).join(" + ") || "—"}</span>
            <span className="xr-chips">{sub(c.acceptsEmail, !!c.email)}{c.taxExempt && <span className="badge">Tax exempt</span>}</span>
          </div>
        ))}
        {data && !items.length && <div className="xr-empty"><div aria-hidden>👥</div><b>{q || filter !== "all" ? "No customers match" : "No customers yet"}</b><span>{q || filter !== "all" ? "Try another search or filter." : "Add one, or import a CSV."}</span></div>}
        {!data && !error && <div className="xr-empty"><span>Loading…</span></div>}
      </div>

      {!!data?.total && (
        <div className="pager">
          <button aria-label="Previous page" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>‹</button>
          <span>{from}–{to}</span>
          <button aria-label="Next page" disabled={to >= data.total} onClick={() => setPage((p) => p + 1)}>›</button>
          <span className="muted">of {data.total}</span>
        </div>
      )}

      {importing && <ImportCustomers onDone={() => { load(); loadCounts(); }} onClose={() => setImporting(false)} />}
      {open && <CustomerDetails customer={open} onSaved={() => { setOpen(null); load(); loadCounts(); }} onClose={() => setOpen(null)} />}
    </>
  );
}
