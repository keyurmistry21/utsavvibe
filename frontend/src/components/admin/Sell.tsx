"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { api, money } from "@/lib/api";
import { FieldError, useValidation } from "./validation";
import * as v from "@/lib/validators";

type Found = {
  variantId: string; title: string; variant: string; options: Record<string, string>; sku: string | null; imageId: string | null;
  market: { id: string; code: string; currency: string; name: string; taxInclusive: boolean };
  price: number | null; stock: number; tracked: boolean; canSell: boolean;
  locations: { id: string; name: string; isDefault: boolean }[];
};
type Sale = { orderId: string; number: number; url: string; total: number; currency: string; expiresInMinutes: number };
type Status = { paymentStatus: string; status: string };

/**
 * In-store sale on a phone. The salesperson scans the product QR (opens /p/<code>, which sends signed-in staff here),
 * checks the product, enters the customer, and shows a one-off Stripe payment QR. The server sets price, tax and stock.
 */
export function Sell({ code: initial }: { code?: string }) {
  const [code, setCode] = useState(initial ?? "");
  const [p, setP] = useState<Found | null>(null);
  const [err, setErr] = useState("");
  const [qty, setQty] = useState("1");
  const [loc, setLoc] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [sale, setSale] = useState<Sale | null>(null);
  const [qr, setQr] = useState("");
  const [paid, setPaid] = useState(false);
  const [gone, setGone] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const lookup = async (c: string) => {
    if (!c.trim()) return;
    setErr(""); setP(null); setSale(null); setPaid(false); setGone("");
    try {
      const r = await api<Found>(`/pos/lookup?code=${encodeURIComponent(c.trim())}`);
      setP(r); setLoc(r.locations.find((l) => l.isDefault)?.id ?? r.locations[0]?.id ?? "");
    } catch (e) { setErr((e as Error).message); }
  };
  useEffect(() => { if (initial) lookup(initial); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [initial]);

  const n = Math.max(1, parseInt(qty) || 1);
  const errors = { name: v.required(name, "Enter the customer's name"), email: v.email(email, true), phone: v.phone(phone), qty: v.int(qty, 1, 99, "quantity") };
  const val = useValidation(errors);

  const confirm = async () => {
    if (!p || !val.submit()) return;
    setBusy(true); setErr("");
    try {
      const s = await api<Sale>("/pos/sale", { method: "POST", json: { variantId: p.variantId, marketId: p.market.id, quantity: n, locationId: loc || undefined, name, email, phone: phone || undefined } });
      setSale(s);
      setQr(await QRCode.toDataURL(s.url, { margin: 2, width: 420, errorCorrectionLevel: "M" }));
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  // wait for the Stripe webhook to mark it paid
  useEffect(() => {
    if (!sale || paid || gone) return;
    const t = setInterval(async () => {
      try {
        const s = await api<Status>(`/pos/sale/${sale.orderId}`);
        if (s.paymentStatus === "paid") setPaid(true);
        else if (s.status === "cancelled") setGone("This payment link expired or was cancelled.");
      } catch { /* keep trying */ }
    }, 3000);
    return () => clearInterval(t);
  }, [sale, paid, gone]);

  const cancel = async () => {
    if (!sale) return;
    await api(`/pos/sale/${sale.orderId}/cancel`, { method: "POST" }).catch(() => {});
    setSale(null); setQr("");
  };
  const another = () => { setP(null); setSale(null); setQr(""); setPaid(false); setGone(""); setCode(""); setName(""); setEmail(""); setPhone(""); setQty("1"); setTimeout(() => input.current?.focus(), 50); };

  const total = p?.price != null ? p.price * n : null;
  const opts = p ? Object.entries(p.options).map(([k, x]) => `${k}: ${x}`).join(" · ") : "";

  return (
    <div className="sellpage">
      <h1 className="pagetitle">Sell in store</h1>

      {!p && !sale && (
        <div className="card">
          <p className="muted">Scan the product's QR code with your phone camera (you'll land here when signed in), or enter its SKU.</p>
          <form onSubmit={(e) => { e.preventDefault(); lookup(code); }} className="row">
            <input ref={input} value={code} onChange={(e) => setCode(e.target.value)} placeholder="SKU or barcode" autoFocus />
            <button className="primary" type="submit">Find</button>
          </form>
          {err && <p className="err">{err}</p>}
        </div>
      )}

      {p && !sale && (
        <div className="card">
          <div className="sellprod">
            {p.imageId && <img src={`/uploads/${p.imageId}-thumb.webp`} alt="" width={84} height={84} />}
            <div>
              <b>{p.title}</b>{p.variant && <div>{p.variant}</div>}
              {opts && <div className="muted">{opts}</div>}
              <div className="muted">SKU {p.sku ?? "–"} · {p.market.name}</div>
              <div><b>{p.price != null ? money(p.price, p.market.currency) : "No price"}</b> · {p.tracked ? `${p.stock} in stock` : "stock not tracked"}</div>
            </div>
          </div>
          {!p.canSell && <p className="err">Not available to sell: {p.price == null ? "no price in this market." : "out of stock."}</p>}
          {p.canSell && (
            <>
              <div className="field"><label htmlFor="s-qty">Quantity</label><input id="s-qty" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} {...val.props("qty")} /><FieldError k="qty" msg={val.err("qty")} /></div>
              {p.locations.length > 1 && (
                <div className="field"><label htmlFor="s-loc">Store location</label>
                  <select id="s-loc" value={loc} onChange={(e) => setLoc(e.target.value)}>{p.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
              )}
              <div className="field"><label htmlFor="s-name">Customer name</label><input id="s-name" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} {...val.props("name")} /><FieldError k="name" msg={val.err("name")} /></div>
              <div className="field"><label htmlFor="s-email">Customer email</label><input id="s-email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} {...val.props("email")} /><FieldError k="email" msg={val.err("email")} /></div>
              <div className="field"><label htmlFor="s-phone">Phone (optional)</label><input id="s-phone" inputMode="tel" autoComplete="off" value={phone} onChange={(e) => setPhone(e.target.value)} {...val.props("phone")} /><FieldError k="phone" msg={val.err("phone")} /></div>
              <p className="muted">Total {total != null ? money(total, p.market.currency) : ""}{p.market.taxInclusive ? " (tax included)" : " plus tax"}. The final amount is worked out by the server.</p>
              {err && <p className="err">{err}</p>}
              <div className="row"><button className="primary" disabled={busy} onClick={confirm}>{busy ? "Creating…" : "Confirm and show payment QR"}</button><button onClick={another}>Back</button></div>
            </>
          )}
          {!p.canSell && <div className="row"><button onClick={another}>Scan another</button></div>}
        </div>
      )}

      {sale && (
        <div className="card sellpay">
          {paid ? (
            <>
              <h2>Paid ✓</h2>
              <p>Order #{sale.number} is paid. The customer gets a confirmation email and stock is updated.</p>
              <div className="row"><button className="primary" onClick={another}>Next sale</button></div>
            </>
          ) : gone ? (
            <>
              <p className="err">{gone}</p>
              <div className="row"><button className="primary" onClick={another}>Start again</button></div>
            </>
          ) : (
            <>
              <h2>Customer scans to pay</h2>
              <p><b>{money(sale.total, sale.currency)}</b> · order #{sale.number}</p>
              {qr && <img src={qr} alt="Payment QR code" width={260} height={260} />}
              <p className="muted">Opens secure Stripe checkout on their phone. Valid for {sale.expiresInMinutes} minutes. Waiting for payment…</p>
              <div className="row"><button onClick={cancel}>Cancel sale</button></div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
