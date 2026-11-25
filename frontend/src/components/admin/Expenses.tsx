"use client";

import { useCallback, useEffect, useState } from "react";
import { api, download, money, toMajor, toMinor } from "@/lib/api";
import { today } from "@/lib/dates";
import { useCan } from "@/lib/perms";
import { useAdminMarket } from "@/lib/adminMarket";
import { money as moneyErr, maxLen } from "@/lib/validators";
import { FieldError, useValidation } from "./validation";
import { Modal } from "./Modal";
import { Banner } from "./Banner";

type Exp = { id: string; date: string; amount: number; currency: string; vendor: string; note: string; createdBy: string };
type List = { items: Exp[]; totals: { currency: string; amount: number }[]; truncated: boolean };
type Meta = { currencies: string[] };
type Form = { id?: string; date: string; amount: string; currency: string; vendor: string; note: string };

function ExpenseForm({ initial, meta, onClose, onSaved }: { initial: Form; meta: Meta; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState(initial);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Form, v: string) => setF((c) => ({ ...c, [k]: v }));
  const val = useValidation({
    date: !f.date ? "Choose the date" : f.date > today() ? "The date can't be in the future" : "",
    amount: moneyErr(f.amount, { label: "amount", max: 9_999_999.99 }),
    vendor: maxLen(f.vendor, 120, "The vendor"),
    note: maxLen(f.note, 500, "The note"),
  });
  const save = async () => {
    if (!val.submit()) return;
    setBusy(true); setErr("");
    try {
      await api(f.id ? `/expenses/${f.id}` : "/expenses", { method: f.id ? "PUT" : "POST", json: { date: f.date, amount: toMinor(f.amount), currency: f.currency, vendor: f.vendor, note: f.note } });
      onSaved();
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  return (
    <Modal title={f.id ? "Edit expense" : "Add expense"} onClose={onClose} footer={<><button onClick={onClose}>Cancel</button><button className="primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save expense"}</button></>}>
      {err && <div className="error">{err}</div>}
      <div className="row">
        <div className="field"><label htmlFor="ex-date">Date</label><input id="ex-date" type="date" max={today()} value={f.date} onChange={(e) => set("date", e.target.value)} {...val.props("date")} /><FieldError k="date" msg={val.err("date")} /></div>
        <div className="field"><label htmlFor="ex-amt">Amount</label><input id="ex-amt" inputMode="decimal" autoFocus placeholder="0.00" value={f.amount} onChange={(e) => set("amount", e.target.value)} {...val.props("amount")} /><FieldError k="amount" msg={val.err("amount")} /></div>
        <div className="field"><label>Currency</label><div className="readonly" title="Change it with Working in (sidebar)">{f.currency}</div></div>
      </div>
      <div className="field"><label htmlFor="ex-vendor">Bought from (optional)</label><input id="ex-vendor" value={f.vendor} onChange={(e) => set("vendor", e.target.value)} placeholder="e.g. Amazon, local printer" {...val.props("vendor")} /><FieldError k="vendor" msg={val.err("vendor")} /></div>
      <div className="field"><label htmlFor="ex-note">What was it for? (optional)</label><input id="ex-note" value={f.note} onChange={(e) => set("note", e.target.value)} placeholder="e.g. 200 gift boxes for Diwali" {...val.props("note")} /><FieldError k="note" msg={val.err("note")} /></div>
      <p className="muted" style={{ fontSize: 13 }}>The currency is the one of the market you work in. To record in another currency, switch <b>Working in</b> in the sidebar.</p>
      <p className="muted" style={{ fontSize: 13 }}>Don't enter card or bank numbers. Just what was bought and how much.</p>
    </Modal>
  );
}

export function Expenses() {
  const { can } = useCan();
  const manage = can("expenses.manage");
  const { market, markets } = useAdminMarket();
  const cur = markets.find((m) => m.code === market)?.currency ?? ""; // expenses are in the currency of the market you work in
  const [meta, setMeta] = useState<Meta | null>(null);
  const [data, setData] = useState<List | null>(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState<Form | null>(null);
  const load = useCallback(() => { api<List>(`/expenses${cur ? `?currency=${cur}` : ""}`).then((r) => { setData(r); setError(""); }).catch((e) => setError(e.message)); }, [cur]);
  useEffect(() => { api<Meta>("/expenses/meta").then(setMeta).catch((e) => setError(e.message)); }, []);
  useEffect(load, [load]);
  const blank = (): Form => ({ date: today(), amount: "", currency: cur, vendor: "", note: "" });

  const items = data?.items ?? [];
  const ym = today().slice(0, 7);
  const thisMonth = items.filter((e) => e.date.startsWith(ym)).reduce((a, e) => a + e.amount, 0);
  const total = items.reduce((a, e) => a + e.amount, 0);
  const byVendor = new Map<string, number>();
  for (const e of items) { const v = e.vendor || "Other"; byVendor.set(v, (byVendor.get(v) ?? 0) + e.amount); }
  const topVendor = [...byVendor.entries()].sort((a, b) => b[1] - a[1])[0];
  const c = cur || items[0]?.currency || "";
  const day = (d: string) => { const x = new Date(`${d}T00:00:00`); return { n: x.getDate(), m: x.toLocaleDateString("en", { month: "short" }) }; };

  return (
    <>
      <div className="pagehead">
        <h2>Expenses</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => download(`/expenses/export${cur ? `?currency=${cur}` : ""}`, "expenses.csv").catch((e) => setError(e.message))}>Export CSV</button>
          {manage && meta && <button className="primary" disabled={!cur} title={cur ? "" : "Choose a market under Working in first"} onClick={() => setForm(blank())}>Add expense</button>}
        </div>
      </div>
      {error && <div className="error">{error}</div>}
      {manage && !cur && <div className="notice">To add an expense, choose your market under <b>Working in</b> in the sidebar. Expenses are recorded in that market&apos;s currency.</div>}

      <Banner title="Expenses summary" stats={[
        { label: cur ? `Spent · ${cur}` : "Spent", value: c ? money(total, c) : "–", tone: "out" },
        { label: "This month", value: c ? money(thisMonth, c) : "–", tone: "low" },
        { label: "Expenses recorded", value: items.length, tone: "arch" },
        { label: topVendor ? `Most spent on · ${topVendor[0]}` : "Most spent on", value: topVendor && c ? money(topVendor[1], c) : "–", tone: "ok" },
      ]}>
        <span className="bn-note">Record what the business spends. It is subtracted from earnings on the Earnings page to show profit.{cur ? ` Showing ${cur} expenses (your Working in market).` : ""}</span>
      </Banner>

      <div className="xr-list">
        {items.map((e) => {
          const d = day(e.date);
          return (
            <div key={e.id} className="xr out" style={{ ["--cols" as string]: "50px minmax(0,1.6fr) minmax(0,1fr) 110px auto" }}>
              <span className="xr-date"><b>{d.n}</b><small>{d.m}</small></span>
              <span className="xr-main"><b>{e.vendor || "No vendor"}</b><small>{e.note || "No note"}</small></span>
              <span className="xr-sub hide-s">Added by {e.createdBy}</span>
              <span className="xr-num">{money(e.amount, e.currency)}</span>
              {manage ? (
                <span className="xr-act">
                  <button onClick={() => setForm({ id: e.id, date: e.date, amount: toMajor(e.amount), currency: e.currency, vendor: e.vendor, note: e.note })}>Edit</button>
                  <button className="del" onClick={async () => { if (!confirm(`Delete this ${money(e.amount, e.currency)} expense?`)) return; await api(`/expenses/${e.id}`, { method: "DELETE" }).catch((x) => setError(x.message)); load(); }}>Delete</button>
                </span>
              ) : <span />}
            </div>
          );
        })}
        {data && !items.length && <div className="xr-empty"><div aria-hidden>🧾</div><b>No expenses yet</b><span>Add the first one when you buy something for the business.</span></div>}
        {data?.truncated && <p className="muted">Showing the newest 500. Export the CSV to get all of them.</p>}
      </div>
      {form && meta && <ExpenseForm initial={form} meta={meta} onClose={() => setForm(null)} onSaved={() => { setForm(null); load(); }} />}
    </>
  );
}
