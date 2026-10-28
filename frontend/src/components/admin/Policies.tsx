"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { ArrowLeft } from "../Icons";
import { RichTextEditor } from "./RichTextEditor";
import { useApi } from "./hooks";

type Row = { key: string; title: string; published: boolean; updatedAt: string | null };

// Starting points only. Placeholders in [brackets] must be replaced, and none of this is legal advice.
const TEMPLATES: Record<string, string> = {
  refund: "<h2>Returns and refunds</h2><p>You can return most items within [30] days of delivery for a refund, as long as they are unused and in their original packaging.</p><p>To start a return, contact us at [your email] with your order number. We will send return instructions. Return shipping is paid by [you / us].</p><p>Refunds go back to your original payment method within [5 to 10] business days of us receiving the item. Items made to order or personalised cannot be returned unless faulty.</p>",
  privacy: "<h2>Privacy policy</h2><p>This policy explains what personal information [store name] collects and how we use it.</p><h3>What we collect</h3><p>Your name, email, phone number, delivery address and order details when you place an order, plus basic site usage data.</p><h3>How we use it</h3><p>To process and deliver orders, send order updates, provide support and meet legal obligations. Card details are handled by Stripe and never stored by us.</p><h3>Your rights</h3><p>You can ask to see, correct or delete your information at any time by contacting [your email].</p>",
  terms: "<h2>Terms of service</h2><p>By using this website and placing an order you agree to these terms.</p><p>Prices are shown in your market's currency and may change without notice. An order is accepted when we confirm it by email. We may cancel an order if an item is unavailable or a pricing error occurred, and will refund you in full.</p><p>These terms are governed by the laws of [your jurisdiction]. Contact: [your email].</p>",
  shipping: "<h2>Shipping policy</h2><p>We ship from [your location] to the countries shown at checkout. Orders are usually dispatched within [1 to 3] business days.</p><p>Delivery times and prices depend on your location and are shown at checkout. You will receive a tracking number by email when your order ships. Duties and import taxes, where they apply, are [included / paid by the customer].</p>",
  contact: "<h2>Contact us</h2><p>[Store name]</p><p>Email: [your email]<br>Phone: [your phone]<br>Address: [your address]</p><p>Opening hours: [days and hours]</p>",
  legal: "<h2>Legal notice</h2><p>[Registered company name], registered in [country], company number [number].</p><p>Registered address: [address]. Tax / VAT number: [number].</p>",
  cancellation: "<h2>Cancellation policy</h2><p>You can cancel an order before it ships by contacting [your email] with your order number. Once an order has shipped, our returns policy applies.</p>",
};

function PolicyEditor({ row, onDone }: { row: Row; onDone: () => void }) {
  const { data } = useApi<{ content: string }>(`/policies/${row.key}`);
  const [content, setContent] = useState<string | null>(null);
  const [reset, setReset] = useState(0);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const value = content ?? data?.content ?? "";
  const save = async () => {
    setBusy(true); setErr("");
    try { await api(`/policies/${row.key}`, { method: "PUT", json: { content: value } }); onDone(); } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  const useTemplate = () => {
    if (value.replace(/<[^>]*>/g, "").trim() && !confirm("Replace what you have written with the starter template?")) return;
    setContent(TEMPLATES[row.key] ?? ""); setReset((n) => n + 1);
  };
  return (
    <>
      <div className="crumbbar"><button className="link crumb" onClick={onDone}><ArrowLeft />Policies</button></div>
      <div className="pagehead"><h2>{row.title}</h2><div className="headtools"><button onClick={useTemplate}>Use starter template</button></div></div>
      {err && <div className="error">{err}</div>}
      <div className="card" style={{ maxWidth: 820 }}>
        {data ? <RichTextEditor value={value} onChange={setContent} resetKey={`${row.key}-${reset}-${data ? "1" : "0"}`} /> : <p className="muted">Loading…</p>}
        <p className="muted" style={{ marginBottom: 0 }}>Leave it empty to unpublish. Published policies are linked in the footer of your online store. Templates contain [brackets] you must fill in, and aren't legal advice.</p>
      </div>
      <div className="savebar"><span style={{ flex: 1 }} /><button onClick={onDone}>Discard</button><button className="primary" disabled={busy || !data} onClick={save}>{busy ? "Saving…" : "Save"}</button></div>
    </>
  );
}

export function Policies() {
  const { data: rows, error, reload } = useApi<Row[]>("/policies");
  const [edit, setEdit] = useState<Row | null>(null);
  if (edit) return <PolicyEditor key={edit.key} row={edit} onDone={() => { setEdit(null); reload(); }} />;
  return (
    <>
      <div className="pagehead"><div><h2>Policies</h2><div className="muted">Written policies appear in the footer of your online store.</div></div></div>
      {error && <div className="error">{error}</div>}
      <div className="card" style={{ maxWidth: 820 }}>
        <div className="tablescroll">
          <table>
            <tbody>
              {rows?.map((r) => (
                <tr key={r.key} className="clickable" onClick={() => setEdit(r)}>
                  <td><b>{r.title}</b></td>
                  <td><span className={`badge ${r.published ? "ok" : ""}`}>{r.published ? "Published" : "Not set"}</span></td>
                  <td className="muted" style={{ textAlign: "right" }}>{r.updatedAt ? new Date(r.updatedAt).toLocaleDateString() : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ marginBottom: 0 }}>Recommended policies are not legal advice. You are responsible for making sure they are accurate and comply with the laws that apply to you.</p>
      </div>
    </>
  );
}
