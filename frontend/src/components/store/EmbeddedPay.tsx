"use client";

import { useState } from "react";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import type { Stripe } from "@stripe/stripe-js";

type Prepared = { clientSecret: string; returnUrl: string } | null;

// Card, Apple Pay and Google Pay are typed or tapped in Stripe's own secure fields: card numbers never touch our server.
export function EmbeddedPay({ stripe, amount, currency, label, disabled, onPrepare }: {
  stripe: Promise<Stripe | null>; amount: number; currency: string; label: string; disabled?: boolean; onPrepare: () => Promise<Prepared>;
}) {
  return (
    <Elements stripe={stripe} options={{ mode: "payment", amount: Math.max(50, amount), currency: currency.toLowerCase(), paymentMethodCreation: "manual", appearance: { theme: "stripe", variables: { colorPrimary: "#f97203", borderRadius: "10px", fontFamily: "inherit" } } }}>
      <Inner label={label} disabled={disabled} onPrepare={onPrepare} />
    </Elements>
  );
}

function Inner({ label, disabled, onPrepare }: { label: string; disabled?: boolean; onPrepare: () => Promise<Prepared> }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [ready, setReady] = useState(false);

  const pay = async () => {
    if (!stripe || !elements) return;
    setMsg(""); setBusy(true);
    try {
      const sub = await elements.submit(); // validates the card fields
      if (sub.error) { setMsg(sub.error.message ?? "Check your payment details"); return; }
      const p = await onPrepare(); // validates the form, creates the order and the payment on the server
      if (!p) return;
      const { error } = await stripe.confirmPayment({ elements, clientSecret: p.clientSecret, confirmParams: { return_url: p.returnUrl } });
      if (error) setMsg(error.message ?? "Payment failed. Please try another card.");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cp-embed">
      <PaymentElement onReady={() => setReady(true)} options={{ layout: "tabs" }} />
      {msg && <div className="error" role="alert" style={{ marginTop: 12 }}>{msg}</div>}
      <button className="primary cp-pay" disabled={!stripe || !ready || busy || disabled} onClick={pay}>{busy ? "Processing…" : label}</button>
    </div>
  );
}
