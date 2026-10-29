"use client";

import { useEffect, useState } from "react";
import { api, money } from "@/lib/api";
import { decimal, int } from "@/lib/validators";
import { FieldError, useValidation } from "./validation";

type Rate = { id: string; carrier: string; service: string; amount: number; currency: string; days: number | null };
type Info = { configured: boolean; label: { url: string | null; cost: number | null; currency: string | null } | null };

// Buy carrier postage through Shippo. Buying spends real money, so it only happens after you pick a rate and confirm.
export function ShippingLabel({ orderId, weightG, tick, onChanged }: { orderId: string; weightG: string; tick: number; onChanged: (msg: string) => void }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [p, setP] = useState({ l: "", w: "", h: "", g: weightG });
  const [rates, setRates] = useState<{ rates: Rate[]; international: boolean } | null>(null);
  const [pick, setPick] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");

  useEffect(() => { api<Info>(`/orders/${orderId}/shipping`).then(setInfo).catch((e) => setErr(e.message)); }, [orderId, tick]);
  useEffect(() => { if (!p.g && weightG) setP((c) => ({ ...c, g: weightG })); }, [weightG]); // eslint-disable-line react-hooks/exhaustive-deps

  const val = useValidation({
    l: decimal(p.l, 300, "length") || (!p.l ? "Enter the length" : ""), w: decimal(p.w, 300, "width") || (!p.w ? "Enter the width" : ""), h: decimal(p.h, 300, "height") || (!p.h ? "Enter the height" : ""),
    g: int(p.g, 1, 70000, "weight"),
  });

  if (!info) return err ? <div className="card"><h3>Carrier postage</h3><div className="error">{err}</div></div> : null;

  const getRates = async () => {
    if (!val.submit()) return;
    setErr(""); setBusy("rates"); setRates(null); setPick("");
    try {
      const r = await api<{ rates: Rate[]; international: boolean }>(`/orders/${orderId}/shipping/rates`, { method: "POST", json: { parcel: { lengthCm: Number(p.l), widthCm: Number(p.w), heightCm: Number(p.h), weightG: parseInt(p.g) } } });
      setRates(r); setPick(r.rates[0]?.id ?? "");
    } catch (e) { setErr((e as Error).message); } finally { setBusy(""); }
  };
  const buy = async () => {
    const r = rates?.rates.find((x) => x.id === pick);
    if (!r || !confirm(`Buy ${r.carrier} ${r.service} for ${money(r.amount, r.currency)}?\n\nThis is charged to your Shippo account.`)) return;
    setErr(""); setBusy("buy");
    try { await api(`/orders/${orderId}/shipping/buy`, { method: "POST", json: { rateId: r.id } }); setRates(null); onChanged("Label bought. Tracking number saved on the order."); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(""); }
  };
  const voidIt = async () => {
    if (!confirm("Void this label? The carrier refunds the postage to your Shippo account, usually within a few days. Only void a label you have not used.")) return;
    setErr(""); setBusy("void");
    try { await api(`/orders/${orderId}/shipping/void`, { method: "POST" }); onChanged("Label voided. The postage will be refunded by the carrier."); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(""); }
  };
  const fld = (k: "l" | "w" | "h" | "g", label: string, id: string) => (
    <div className="field"><label htmlFor={id}>{label}</label><input id={id} inputMode="decimal" value={p[k]} onChange={(e) => { setP({ ...p, [k]: e.target.value }); setRates(null); }} {...val.props(k)} /><FieldError k={k} msg={val.err(k)} /></div>
  );

  return (
    <div className="card">
      <h3>Carrier postage</h3>
      {err && <div className="error">{err}</div>}
      {info.label ? (
        <>
          <p>Label bought{info.label.cost != null && info.label.currency ? ` for ${money(info.label.cost, info.label.currency)}` : ""}. The carrier and tracking number are saved on this order.</p>
          <div className="actions">
            {info.label.url && /^https:\/\//.test(info.label.url) && <a className="btn-link" href={info.label.url} target="_blank" rel="noopener noreferrer">Open label (PDF)</a>}
            <button disabled={busy === "void"} onClick={voidIt}>{busy === "void" ? "Voiding…" : "Void label"}</button>
          </div>
        </>
      ) : !info.configured ? (
        <p className="muted" style={{ margin: 0 }}>Buying postage is not switched on. Create a free Shippo account, connect your carriers and a payment method there, then add <code>SHIPPO_API_KEY</code> to <code>backend/.env</code> and restart the API. Until then you can still enter a tracking number by hand above. Never type card details into this app: postage is charged by Shippo.</p>
      ) : (
        <>
          <p className="muted" style={{ marginTop: 0 }}>Enter the packed parcel, compare carrier prices, then buy. Nothing is charged until you confirm.</p>
          <div className="row">{fld("l", "Length (cm)", "sl-l")}{fld("w", "Width (cm)", "sl-w")}{fld("h", "Height (cm)", "sl-h")}{fld("g", "Weight (g)", "sl-g")}</div>
          <button disabled={busy === "rates"} onClick={getRates}>{busy === "rates" ? "Getting rates…" : "Get rates"}</button>
          {rates && (
            <>
              {rates.international && <p className="muted">International parcel: customs details are filled in from the order items. Check them with your carrier.</p>}
              <div role="radiogroup" aria-label="Carrier rates" style={{ margin: "12px 0" }}>
                {rates.rates.map((r) => (
                  <label key={r.id} className="check" style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 0" }}>
                    <input type="radio" name="rate" checked={pick === r.id} onChange={() => setPick(r.id)} />
                    <span style={{ flex: 1 }}><b>{r.carrier}</b> {r.service}{r.days ? <span className="muted"> · about {r.days} day{r.days === 1 ? "" : "s"}</span> : ""}</span>
                    <b>{money(r.amount, r.currency)}</b>
                  </label>
                ))}
              </div>
              <p className="muted" style={{ marginTop: 0 }}>These are the rates Shippo returns for the carriers you've connected. Discounted rates: Shippo includes discounted commercial USPS/UPS/DHL rates when you enable Shippo-managed carrier accounts in your Shippo dashboard.</p>
              <button className="primary" disabled={!pick || busy === "buy"} onClick={buy}>{busy === "buy" ? "Buying…" : "Buy label"}</button>
            </>
          )}
        </>
      )}
    </div>
  );
}
