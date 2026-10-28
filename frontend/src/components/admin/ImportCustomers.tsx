"use client";

import { useRef, useState } from "react";
import { api } from "@/lib/api";
import { mapCustomerCSV, parseCSV } from "@/lib/csv";
import { Modal } from "./Modal";

type Result = { created: number; updated: number; skipped: number; errors: { row: number; error: string }[] };

export function ImportCustomers({ onDone, onClose }: { onDone: () => void; onClose: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ReturnType<typeof mapCustomerCSV> | null>(null);
  const [fileName, setFileName] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<Result | null>(null);

  const pick = async (f?: File) => {
    setErr(""); setParsed(null); setResult(null);
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) return setErr("That file is larger than 5 MB. Split it into smaller files.");
    const rows = parseCSV(await f.text());
    if (rows.length < 2) return setErr("The file has no customer rows.");
    const m = mapCustomerCSV(rows);
    if (!m.mapped.includes("email") && !m.mapped.includes("phone")) return setErr("Couldn’t find an Email or Phone column. Use a Shopify customer export or this app’s export.");
    setFileName(f.name); setParsed(m);
  };

  const run = async () => {
    if (!parsed) return;
    setBusy(true); setErr(""); setProgress(0);
    const total: Result = { created: 0, updated: 0, skipped: 0, errors: [] };
    try {
      for (let i = 0; i < parsed.rows.length; i += 500) {
        const r = await api<Result>("/customers/import", { method: "POST", json: { rows: parsed.rows.slice(i, i + 500) } });
        total.created += r.created; total.updated += r.updated; total.skipped += r.skipped;
        total.errors.push(...r.errors.map((e) => ({ ...e, row: e.row + i })));
        setProgress(Math.min(100, Math.round(((i + 500) / parsed.rows.length) * 100)));
      }
      setResult(total);
      onDone();
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  return (
    <Modal
      title="Import customers by CSV"
      onClose={onClose}
      dismissOnScrim={!busy}
      footer={
        <>
          <span className="muted">{parsed && !result ? `${parsed.rows.length} customer rows ready` : ""}</span>
          <span style={{ display: "flex", gap: 12 }}>
            <button onClick={onClose}>{result ? "Close" : "Cancel"}</button>
            {!result && <button className="primary" disabled={!parsed || busy} onClick={run}>{busy ? `Importing… ${progress}%` : "Import customers"}</button>}
          </span>
        </>
      }
    >
      {!result && (
        <>
          <p className="muted">Upload a CSV exported from Shopify, or one exported from this page. Existing customers (matched by email) are updated, new ones are added. Imported customers are not emailed.</p>
          <div className="dropzone wide" onClick={() => input.current?.click()}>
            <b>{fileName || "Add file"}</b>
            <span>{fileName ? "Click to choose a different file" : "CSV, up to 5 MB"}</span>
          </div>
          <input ref={input} type="file" accept=".csv,text/csv" hidden onChange={(e) => pick(e.target.files?.[0])} />
        </>
      )}
      {parsed && !result && (
        <div style={{ marginTop: 16 }}>
          <p><b>Columns we’ll import:</b> {parsed.mapped.join(", ")}</p>
          {!!parsed.unmapped.length && <p className="muted">Ignored: {parsed.unmapped.slice(0, 12).join(", ")}{parsed.unmapped.length > 12 ? "…" : ""}</p>}
        </div>
      )}
      {result && (
        <div>
          <div className="okmsg">{result.created} added · {result.updated} updated · {result.skipped} skipped</div>
          {!!result.errors.length && (
            <>
              <p className="muted">Rows that couldn’t be imported:</p>
              <ul className="maillog">{result.errors.map((e) => <li key={e.row}><span>Row {e.row + 1}</span><span className="muted">{e.error}</span></li>)}</ul>
            </>
          )}
        </div>
      )}
      {err && <div className="error">{err}</div>}
    </Modal>
  );
}
