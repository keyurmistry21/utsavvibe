"use client";

import { useEffect, useState } from "react";
import { money } from "@/lib/api";
import { useCart } from "./cart";
import { Select } from "../Select";
import { email as emailErr, maxLen, phone as phoneErr, postcode as postcodeErr, required } from "@/lib/validators";
import { FieldError, useValidation } from "../admin/validation";
import { track } from "@/lib/track";

type Quote = {
  currency: string; taxInclusive: boolean; region: string | null;
  lines: { variantId: string; title: string; quantity: number; unitPrice: number }[];
  subtotal: number; tax: number; shipping: number; total: number; taxSource?: "stripe" | "market"; freeShippingRemaining?: number | null;
  giftCardApplied: number; amountDue: number; giftCardBalance: number | null;
  stock?: { variantId: string; title: string; requested: number; available: number | null; ok: boolean }[];
};

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/store${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error === "validation" ? "Please check the form fields" : data.error ?? "Something went wrong");
  return data as T;
}

export function CartPage({ market, country, regions }: { market: string; country: string; regions: { code: string; name: string; taxRateBps: number }[] }) {
  const { lines, setQty, count, replace } = useCart();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [recheck, setRecheck] = useState(0); // bump to ask the server for fresh stock
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [region, setRegion] = useState("");
  const [giftInput, setGiftInput] = useState("");
  const [giftCode, setGiftCode] = useState(""); // applied code; the server re-checks it on every quote and at checkout
  const [giftErr, setGiftErr] = useState("");
  const [f, setF] = useState({ name: "", email: "", phone: "", line1: "", line2: "", city: "", region: "", postcode: "" });
  const [marketing, setMarketing] = useState(false);
  const [debounced, setDebounced] = useState<{ line1: string; city: string; postcode: string } | null>(null);
  const [loaded, setLoaded] = useState(false); // set in the same batch as the restored details, so saving never writes the empty form

  // Returning shopper: details are kept on this device only (never card numbers: those are typed on Stripe's page).
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(`checkout:${market}`) ?? "null");
      if (s?.f) setF((cur) => ({ ...cur, ...s.f }));
      if (s?.region) setRegion(s.region);
    } catch {}
    setLoaded(true);
    // cart reminder link: ?recover=<token> refills the cart and the email address
    const token = new URLSearchParams(location.search).get("recover");
    if (token) {
      fetch(`/api/store/recover/${encodeURIComponent(token)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((c: { marketCode: string; email: string; name: string; items: { variantId: string; title: string; quantity: number }[] } | null) => {
          if (c && c.marketCode.toLowerCase() === market.toLowerCase() && c.items.length) {
            replace(c.items);
            setF((cur) => ({ ...cur, email: cur.email || c.email, name: cur.name || c.name }));
          }
          history.replaceState(null, "", location.pathname);
        })
        .catch(() => {});
    }
  }, [market, replace]);
  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(`checkout:${market}`, JSON.stringify({ f, region })); } catch {}
  }, [f, region, market, loaded]);
  useEffect(() => {
    const t = setTimeout(() => setDebounced({ line1: f.line1, city: f.city, postcode: f.postcode }), 600);
    return () => clearTimeout(t);
  }, [f.line1, f.city, f.postcode]);
  // with a full address the server can ask Stripe Tax (if switched on) for the exact tax
  const taxAddress = debounced && debounced.line1 && debounced.city && !postcodeErr(debounced.postcode, country) && debounced.postcode ? { country, postcode: debounced.postcode, line1: debounced.line1, city: debounced.city, region: region || f.region || undefined } : undefined;

  // Prices always come from the server; the client only sends variant ids + quantities.
  useEffect(() => {
    if (!lines.length) return setQuote(null);
    setErr("");
    post<Quote>("/quote", { marketCode: market.toUpperCase(), region: region || undefined, giftCardCode: giftCode || undefined, address: taxAddress, items: lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })) })
      .then(setQuote)
      .catch((e) => { setErr(e.message); if (giftCode) { setGiftCode(""); setGiftErr(e.message); } });
  }, [lines, market, region, giftCode, recheck, taxAddress?.postcode, taxAddress?.line1, taxAddress?.city]);

  // Stock is re-read from the server every time the cart opens or changes; checkout stays off while any line can't be fulfilled.
  const issues = (quote?.stock ?? []).filter((x) => !x.ok);
  const fixCart = () => { for (const x of issues) setQty(x.variantId, x.available ?? 0); };

  const applyGift = async () => {
    setGiftErr("");
    const code = giftInput.trim();
    if (!code) return setGiftErr("Enter your gift card code");
    try {
      await post<Quote>("/quote", { marketCode: market.toUpperCase(), region: region || undefined, giftCardCode: code, items: lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })) });
      setGiftCode(code); setGiftInput("");
    } catch (e) { setGiftErr((e as Error).message); }
  };

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
    track("begin_checkout", { data: { currency: quote?.currency, value: (quote?.total ?? 0) / 100 } });
    setBusy(true);
    setErr("");
    try {
      const { url } = await post<{ url: string }>("/checkout", {
        marketCode: market.toUpperCase(),
        giftCardCode: giftCode || undefined,
        items: lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
        name: f.name, email: f.email, phone: f.phone || undefined, marketing,
        address: { line1: f.line1, line2: f.line2 || undefined, city: f.city, region: region || f.region || undefined, postcode: f.postcode, country },
      });
      location.href = url; // Stripe-hosted checkout; cart is cleared on the order page
    } catch (e) {
      setErr((e as Error).message);
      setRecheck((n) => n + 1); // the failure may be stock: show the latest availability
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
                  <td>{l.title}{(() => { const st = quote?.stock?.find((x) => x.variantId === l.variantId); return st && !st.ok ? <div className="error" role="alert">{st.available ? `Only ${st.available} available` : "Out of stock"}</div> : null; })()}</td>
                  <td style={{ width: 90 }}><input type="number" min={0} max={99} value={l.quantity} onChange={(e) => setQty(l.variantId, +e.target.value)} /></td>
                  <td style={{ textAlign: "right" }}>{q && quote && money(q.unitPrice * l.quantity, quote.currency)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {quote?.freeShippingRemaining != null && quote.freeShippingRemaining > 0 && (
          <div className="shipbar" role="status">
            <span>Add <b>{money(quote.freeShippingRemaining, quote.currency)}</b> more for free shipping</span>
            <div className="shipbar-track"><div style={{ width: `${Math.max(6, Math.round((quote.subtotal / (quote.subtotal + quote.freeShippingRemaining)) * 100))}%` }} /></div>
          </div>
        )}
        {quote && quote.freeShippingRemaining == null && quote.shipping === 0 && <div className="shipbar done" role="status">You've got free shipping</div>}
        {quote && (
          <div className="carttotals">
            <div><span>Subtotal</span><span>{money(quote.subtotal, quote.currency)}</span></div>
            <div><span>Shipping</span><span>{quote.shipping ? money(quote.shipping, quote.currency) : "Free"}</span></div>
            <div className="taxrow"><span>{quote.taxInclusive ? "Includes tax" : "Tax"}{quote.region ? ` (${regions.find((r) => r.code === quote.region)?.name})` : ""}{quote.taxSource === "stripe" ? " for your address" : ""}</span><span>{money(quote.tax, quote.currency)}</span></div>
            {!!regions.length && !quote.region && <div className="muted">Select your province to see exact tax.</div>}
            <div className="grand"><span>Total</span><b>{money(quote.total, quote.currency)}</b></div>
            {quote.giftCardApplied > 0 && <>
              <div><span>Gift card</span><span>−{money(quote.giftCardApplied, quote.currency)}</span></div>
              <div className="grand"><span>To pay</span><b>{money(quote.amountDue, quote.currency)}</b></div>
            </>}
          </div>
        )}
        <div className="giftbox">
          {giftCode ? (
            <p className="giftok">Gift card applied{quote?.giftCardBalance != null ? ` (balance ${money(quote.giftCardBalance, quote.currency)})` : ""}. <button className="link" onClick={() => { setGiftCode(""); setGiftErr(""); }}>Remove</button></p>
          ) : (
            <>
              <div className="giftrow">
                <input aria-label="Gift card code" placeholder="Gift card code" value={giftInput} onChange={(e) => setGiftInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") applyGift(); }} autoComplete="off" />
                <button onClick={applyGift}>Apply</button>
              </div>
              {giftErr && <div className="error" style={{ marginTop: 8 }}>{giftErr}</div>}
            </>
          )}
        </div>
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
        <label className="consent"><input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} /> Email me a reminder if I don't finish checking out. Unsubscribe any time.</label>
        {issues.length > 0 && <div className="error" role="alert">Some items in your cart aren't available in the quantity you chose. <button className="link" type="button" onClick={fixCart}>Update my cart</button></div>}
        {err && <div className="error">{err}</div>}
        <button className="primary" disabled={!quote || busy || issues.length > 0} onClick={checkout}>{busy ? "Please wait…" : quote && quote.giftCardApplied > 0 && quote.amountDue === 0 ? "Place order" : "Pay with Stripe"}</button>
        <p className="trust muted">🔒 Secure payment on Stripe's page. Cards, Apple Pay, Google Pay and Link where available. We never see your card number.</p>
      </div>
    </>
  );
}
