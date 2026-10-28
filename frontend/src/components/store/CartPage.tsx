"use client";

import { useEffect, useState } from "react";
import { money } from "@/lib/api";
import { useCart } from "./cart";
import { Select } from "../Select";
import { email as emailErr, maxLen, phone as phoneErr, postcode as postcodeErr, required } from "@/lib/validators";
import { FieldError, useValidation } from "../admin/validation";

type Quote = {
  currency: string; taxInclusive: boolean; region: string | null;
  lines: { variantId: string; title: string; quantity: number; unitPrice: number }[];
  subtotal: number; tax: number; shipping: number; total: number;
};

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/store${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error === "validation" ? "Please check the form fields" : data.error ?? "Something went wrong");
  return data as T;
}

export function CartPage({ market, country, regions }: { market: string; country: string; regions: { code: string; name: string; taxRateBps: number }[] }) {
  const { lines, setQty, count } = useCart();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [region, setRegion] = useState("");
  const [f, setF] = useState({ name: "", email: "", phone: "", line1: "", line2: "", city: "", region: "", postcode: "" });

  // Prices always come from the server; the client only sends variant ids + quantities.
  useEffect(() => {
    if (!lines.length) return setQuote(null);
    setErr("");
    post<Quote>("/quote", { marketCode: market.toUpperCase(), region: region || undefined, items: lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })) })
      .then(setQuote)
      .catch((e) => setErr(e.message));
  }, [lines, market, region]);

  const E: Record<string, string> = {
    name: required(f.name, "Enter your full name") || maxLen(f.name, 100, "Name"),
    email: emailErr(f.email, true),
    phone: phoneErr(f.phone),
    line1: required(f.line1, "Enter your street address") || maxLen(f.line1, 200, "Address"),
    line2: maxLen(f.line2, 200, "This line"),
    city: required(f.city, "Enter your city") || maxLen(f.city, 100, "City"),
    region: regions.length && !region ? `Select your ${country === "US" ? "state" : "province"}` : "",
    postcode: postcodeErr(f.postcode, country),
  };
  const val = useValidation(E);

  const checkout = async () => {
    if (!val.submit()) return;
    setBusy(true);
    setErr("");
    try {
      const { url } = await post<{ url: string }>("/checkout", {
        marketCode: market.toUpperCase(),
        items: lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
        name: f.name, email: f.email, phone: f.phone || undefined,
        address: { line1: f.line1, line2: f.line2 || undefined, city: f.city, region: region || f.region || undefined, postcode: f.postcode, country },
      });
      location.href = url; // Stripe-hosted checkout; cart is cleared on the order page
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  if (!count) return <p className="muted">Your cart is empty.</p>;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <>
      <h1>Cart</h1>
      <div className="card">
        <table>
          <tbody>
            {lines.map((l) => {
              const q = quote?.lines.find((x) => x.variantId === l.variantId);
              return (
                <tr key={l.variantId}>
                  <td>{l.title}</td>
                  <td style={{ width: 90 }}><input type="number" min={0} max={99} value={l.quantity} onChange={(e) => setQty(l.variantId, +e.target.value)} /></td>
                  <td style={{ textAlign: "right" }}>{q && quote && money(q.unitPrice * l.quantity, quote.currency)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {quote && (
          <div className="carttotals">
            <div><span>Subtotal</span><span>{money(quote.subtotal, quote.currency)}</span></div>
            <div><span>Shipping</span><span>{quote.shipping ? money(quote.shipping, quote.currency) : "Free"}</span></div>
            <div className="taxrow"><span>{quote.taxInclusive ? "Includes tax" : "Tax"}{quote.region ? ` (${regions.find((r) => r.code === quote.region)?.name})` : ""}</span><span>{money(quote.tax, quote.currency)}</span></div>
            {!!regions.length && !quote.region && <div className="muted">Select your province to see exact tax.</div>}
            <div className="grand"><span>Total</span><b>{money(quote.total, quote.currency)}</b></div>
          </div>
        )}
      </div>

      <div className="card">
        <h3>Delivery details ({country})</h3>
        <div className="row">
          <div className="field"><label htmlFor="co-name">Full name</label><input id="co-name" value={f.name} onChange={set("name")} autoComplete="name" {...val.props("name")} /><FieldError k="name" msg={val.err("name")} /></div>
          <div className="field"><label htmlFor="co-email">Email</label><input id="co-email" type="email" value={f.email} onChange={set("email")} autoComplete="email" {...val.props("email")} /><FieldError k="email" msg={val.err("email")} /></div>
          <div className="field"><label htmlFor="co-phone">Phone (optional)</label><input id="co-phone" value={f.phone} onChange={set("phone")} autoComplete="tel" {...val.props("phone")} /><FieldError k="phone" msg={val.err("phone")} /></div>
        </div>
        <div className="row">
          <div className="field"><label htmlFor="co-line1">Address</label><input id="co-line1" value={f.line1} onChange={set("line1")} autoComplete="address-line1" {...val.props("line1")} /><FieldError k="line1" msg={val.err("line1")} /></div>
          <div className="field"><label htmlFor="co-line2">Apartment, suite (optional)</label><input id="co-line2" value={f.line2} onChange={set("line2")} autoComplete="address-line2" {...val.props("line2")} /><FieldError k="line2" msg={val.err("line2")} /></div>
        </div>
        <div className="row">
          <div className="field"><label htmlFor="co-city">City</label><input id="co-city" value={f.city} onChange={set("city")} autoComplete="address-level2" {...val.props("city")} /><FieldError k="city" msg={val.err("city")} /></div>
          {regions.length ? (
            <div className="field"><label>{country === "US" ? "State" : "Province / territory"}</label>
              <Select value={region} onChange={(e) => setRegion(e.target.value)} {...val.props("region")}>
                <option value="">Select…</option>
                {regions.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
              </Select>
              <FieldError k="region" msg={val.err("region")} />
            </div>
          ) : (
            <div className="field"><label>State / region</label><input value={f.region} onChange={set("region")} autoComplete="address-level1" /></div>
          )}
          <div className="field"><label htmlFor="co-post">Postcode</label><input id="co-post" value={f.postcode} onChange={set("postcode")} autoComplete="postal-code" {...val.props("postcode")} /><FieldError k="postcode" msg={val.err("postcode")} /></div>
        </div>
        {err && <div className="error">{err}</div>}
        <button className="primary" disabled={!quote || busy} onClick={checkout}>{busy ? "Redirecting to Stripe…" : "Pay with Stripe"}</button>
      </div>
    </>
  );
}
