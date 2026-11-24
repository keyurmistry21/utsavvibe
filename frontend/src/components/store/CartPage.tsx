"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { money } from "@/lib/api";
import { useCart } from "./cart";
import { Select } from "../Select";
import { email as emailErr, maxLen, phone as phoneErr, required } from "@/lib/validators";
import { FieldError, useValidation } from "../admin/validation";
import { track } from "@/lib/track";
import { getConsent } from "@/lib/consent";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { EmbeddedPay } from "./EmbeddedPay";

type Quote = {
  images?: Record<string, string>;
  currency: string; taxInclusive: boolean; region: string | null;
  lines: { variantId: string; title: string; quantity: number; unitPrice: number }[];
  subtotal: number; tax: number; shipping: number; total: number; taxSource?: "stripe" | "market"; freeShippingRemaining?: number | null;
  giftCardApplied: number; amountDue: number; giftCardBalance: number | null;
  discount?: number; discountCode?: string | null; discountLabel?: string | null; taxBreakdown?: { name: string; amount: number }[];
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
  const [discInput, setDiscInput] = useState("");
  const [discCode, setDiscCode] = useState(""); // discount code the shopper applied; re-checked by the server on every quote and at checkout
  const [discErr, setDiscErr] = useState("");
  const [f, setF] = useState({ name: "", email: "", phone: "", region: "" });
  const [marketing, setMarketing] = useState(false);
  const [method, setMethod] = useState<"card" | "stripe">("card");
  const [stripeJs, setStripeJs] = useState<Promise<Stripe | null> | null>(null); // null until we know a publishable key exists
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
    fetch("/api/store/payment-config").then((r) => r.json()).then((c: { publishableKey: string | null }) => { if (c.publishableKey) setStripeJs(loadStripe(c.publishableKey)); else setMethod("stripe"); }).catch(() => setMethod("stripe"));
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(`checkout:${market}`, JSON.stringify({ f, region })); } catch {}
  }, [f, region, market, loaded]);

  // Prices always come from the server; the client only sends variant ids + quantities.
  useEffect(() => {
    if (!lines.length) return setQuote(null);
    setErr("");
    post<Quote>("/quote", { marketCode: market.toUpperCase(), region: region || undefined, giftCardCode: giftCode || undefined, discountCode: discCode || undefined, items: lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })) })
      .then(setQuote)
      .catch((e) => { if (discCode && /discount|code/i.test(e.message)) { setDiscCode(""); setDiscErr(e.message); return; } setErr(e.message); if (giftCode) { setGiftCode(""); setGiftErr(e.message); } });
  }, [lines, market, region, giftCode, discCode, recheck]);

  // Stock is re-read from the server every time the cart opens or changes; checkout stays off while any line can't be fulfilled.
  const issues = (quote?.stock ?? []).filter((x) => !x.ok);
  const fixCart = () => { for (const x of issues) setQty(x.variantId, x.available ?? 0); };

  const applyDiscount = async () => {
    setDiscErr("");
    const code = discInput.trim();
    if (!code) return setDiscErr("Enter your discount code");
    try {
      await post<Quote>("/quote", { marketCode: market.toUpperCase(), region: region || undefined, discountCode: code, items: lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })) });
      setDiscCode(code); setDiscInput("");
    } catch (e) { setDiscErr((e as Error).message); }
  };

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
    region: regions.length && !region ? `Select your ${country === "US" ? "state" : "province"}` : "",
  };
  const val = useValidation(E);

  // Embedded card form: validate, create the order + PaymentIntent, hand the secret to Stripe's fields.
  const prepareEmbedded = async () => {
    if (!val.submit()) { document.getElementById("cp-delivery")?.scrollIntoView({ behavior: "smooth", block: "start" }); return null; }
    track("begin_checkout", { data: { currency: quote?.currency, value: (quote?.total ?? 0) / 100 } });
    setErr("");
    try {
      return await post<{ clientSecret: string; returnUrl: string }>("/checkout", {
        marketCode: market.toUpperCase(), embedded: true,
        giftCardCode: giftCode || undefined, discountCode: discCode || undefined, consent: getConsent() === "all",
        items: lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
        name: f.name, email: f.email, phone: f.phone || undefined, marketing,
        address: { country, region: region || undefined },
      });
    } catch (e) { setErr((e as Error).message); setRecheck((n) => n + 1); return null; }
  };

  const checkout = async () => {
    if (!val.submit()) return;
    track("begin_checkout", { data: { currency: quote?.currency, value: (quote?.total ?? 0) / 100 } });
    setBusy(true);
    setErr("");
    try {
      const { url } = await post<{ url: string }>("/checkout", {
        marketCode: market.toUpperCase(),
        giftCardCode: giftCode || undefined,
        discountCode: discCode || undefined,
        consent: getConsent() === "all",
        items: lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
        name: f.name, email: f.email, phone: f.phone || undefined, marketing,
        address: { country, region: region || undefined },
      });
      location.href = url; // Stripe-hosted checkout; cart is cleared on the order page
    } catch (e) {
      setErr((e as Error).message);
      setRecheck((n) => n + 1); // the failure may be stock: show the latest availability
      setBusy(false);
    }
  };

  if (!count) return (
    <div className="cp-empty">
      <div className="cp-empty-ic" aria-hidden>🛍️</div>
      <h1>Your cart is empty</h1>
      <p>Looks like you haven't added anything yet. Find something you love and it will show up here.</p>
      <Link className="tbtn" href={`/${market}`}>Continue shopping</Link>
    </div>
  );
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const itemsCount = lines.reduce((n, l) => n + l.quantity, 0);

  return (
    <div className="cp">
      <div className="cp-head"><h1>Your cart</h1><span>{itemsCount} item{itemsCount === 1 ? "" : "s"}</span></div>
      <div className="cp-grid">
        <div className="cp-main">
          <div className="card cp-items">
            {lines.map((l) => {
              const q = quote?.lines.find((x) => x.variantId === l.variantId);
              const st = quote?.stock?.find((x) => x.variantId === l.variantId);
              return (
                <div key={l.variantId} className="cp-line">
                  <div className="cp-img">{(quote?.images?.[l.variantId] ?? l.image) ? <img src={quote?.images?.[l.variantId] ?? l.image} alt="" /> : <span aria-hidden>🛍️</span>}</div>
                  <div className="cp-info">
                    <b>{l.title}</b>
                    {q && quote && <span className="cp-unit">{money(q.unitPrice, quote.currency)} each</span>}
                    {st && !st.ok && <div className="cp-warn" role="alert">{st.available ? `Only ${st.available} available` : "Out of stock"}</div>}
                    <button type="button" className="cp-remove" onClick={() => setQty(l.variantId, 0)}>Remove</button>
                  </div>
                  <div className="cp-stepper" role="group" aria-label={`Quantity of ${l.title}`}>
                    <button type="button" aria-label="Decrease" onClick={() => setQty(l.variantId, l.quantity - 1)}>−</button>
                    <input type="number" min={1} max={99} value={l.quantity} onChange={(e) => setQty(l.variantId, +e.target.value)} aria-label="Quantity" />
                    <button type="button" aria-label="Increase" onClick={() => setQty(l.variantId, l.quantity + 1)}>+</button>
                  </div>
                  <div className="cp-total">{q && quote ? money(q.unitPrice * l.quantity, quote.currency) : "…"}</div>
                </div>
              );
            })}
            <Link href={`/${market}`} className="cp-continue">← Continue shopping</Link>
          </div>

      <div className="card" id="cp-delivery">
        <h3 className="cp-h"><i>1</i>Your details</h3>
        <div className="row">
          <div className="field"><label htmlFor="co-name">Full name</label><input id="co-name" value={f.name} onChange={set("name")} autoComplete="name" {...val.props("name")} /><FieldError k="name" msg={val.err("name")} /></div>
          <div className="field"><label htmlFor="co-email">Email</label><input id="co-email" type="email" value={f.email} onChange={set("email")} autoComplete="email" {...val.props("email")} /><FieldError k="email" msg={val.err("email")} /></div>
          <div className="field"><label htmlFor="co-phone">Phone (optional)</label><input id="co-phone" value={f.phone} onChange={set("phone")} autoComplete="tel" {...val.props("phone")} /><FieldError k="phone" msg={val.err("phone")} /></div>
        </div>
        {regions.length > 0 && (
          <div className="row">
            <div className="field"><label>{country === "US" ? "State" : "Province / territory"} <span className="muted">(used to work out tax)</span></label>
              <Select value={region} onChange={(e) => setRegion(e.target.value)} {...val.props("region")}>
                <option value="">Select…</option>
                {regions.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
              </Select>
              <FieldError k="region" msg={val.err("region")} />
            </div>
          </div>
        )}
        <label className="consent"><input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} /> Email me a reminder if I don't finish checking out. Unsubscribe any time.</label>
        {issues.length > 0 && <div className="error" role="alert">Some items in your cart aren't available in the quantity you chose. <button className="link" type="button" onClick={fixCart}>Update my cart</button></div>}
        {err && <div className="error">{err}</div>}
      </div>
        </div>

        <aside className="cp-side">
          <div className="card cp-sum">
            <h3 className="cp-h"><i>2</i>Order summary</h3>
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
            {!!quote.discount && <div className="discrow"><span>Discount ({quote.discountCode})</span><span>−{money(quote.discount, quote.currency)}</span></div>}
            <div><span>Shipping</span><span>{quote.shipping ? money(quote.shipping, quote.currency) : "Free"}</span></div>
            {quote.taxBreakdown?.length ? quote.taxBreakdown.map((t) => <div key={t.name} className="taxrow"><span>{t.name}{quote.taxInclusive ? " (included)" : ""}</span><span>{money(t.amount, quote.currency)}</span></div>) : (
              <div className="taxrow"><span>{quote.taxInclusive ? "Includes tax" : "Tax"}{quote.region ? ` (${regions.find((r) => r.code === quote.region)?.name})` : ""}{quote.taxSource === "stripe" ? " for your address" : ""}</span><span>{money(quote.tax, quote.currency)}</span></div>
            )}
            {!!regions.length && !quote.region && <div className="muted">Select your province to see exact tax.</div>}
            <div className="grand"><span>Total</span><b>{money(quote.total, quote.currency)}</b></div>
            {quote.giftCardApplied > 0 && <>
              <div><span>Gift card</span><span>−{money(quote.giftCardApplied, quote.currency)}</span></div>
              <div className="grand"><span>To pay</span><b>{money(quote.amountDue, quote.currency)}</b></div>
            </>}
          </div>
        )}
        <div className="giftbox">
          {discCode ? (
            <p className="giftok">Code <b>{quote?.discountCode ?? discCode}</b> applied{quote?.discountLabel ? ` (${quote.discountLabel})` : ""}. <button className="link" onClick={() => { setDiscCode(""); setDiscErr(""); }}>Remove</button></p>
          ) : (
            <>
              <div className="giftrow">
                <input aria-label="Discount code" placeholder="Discount code" value={discInput} onChange={(e) => setDiscInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") applyDiscount(); }} autoComplete="off" />
                <button onClick={applyDiscount}>Apply</button>
              </div>
              {discErr && <div className="error" style={{ marginTop: 8 }}>{discErr}</div>}
            </>
          )}
        </div>
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
        {issues.length > 0 && <div className="error" role="alert">Some items in your cart aren't available in the quantity you chose. <button className="link" type="button" onClick={fixCart}>Update my cart</button></div>}
        {err && <div className="error">{err}</div>}
        {quote && quote.amountDue > 0 && (
          <div className="cp-methods" role="radiogroup" aria-label="Payment method">
            {stripeJs && (
              <label className={method === "card" ? "on" : ""}>
                <input type="radio" name="pm" checked={method === "card"} onChange={() => setMethod("card")} />
                <span><b>Card, Apple Pay or Google Pay</b><small>Pay right here. Visa, Mastercard, Amex and wallets.</small></span>
              </label>
            )}
            <label className={method === "stripe" || !stripeJs ? "on" : ""}>
              <input type="radio" name="pm" checked={method === "stripe" || !stripeJs} onChange={() => setMethod("stripe")} />
              <span><b>Pay on Stripe's secure page</b><small>You'll be taken to Stripe to finish.</small></span>
            </label>
          </div>
        )}
        {quote && quote.amountDue > 0 && method === "card" && stripeJs ? (
          <EmbeddedPay stripe={stripeJs} amount={quote.amountDue} currency={quote.currency} disabled={!quote || issues.length > 0} label={`Pay ${money(quote.amountDue, quote.currency)}`} onPrepare={prepareEmbedded} />
        ) : (
          <button className="primary cp-pay" disabled={!quote || busy || issues.length > 0} onClick={checkout}>{busy ? "Please wait…" : quote && quote.giftCardApplied > 0 && quote.amountDue === 0 ? "Place order" : `Pay ${quote ? money(quote.amountDue, quote.currency) : ""} with Stripe`}</button>
        )}
        <p className="trust muted">🔒 Secure payment on Stripe's page. Cards, Apple Pay, Google Pay and Link where available. We never see your card number.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
