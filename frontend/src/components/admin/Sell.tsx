"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { api, money, toMinor } from "@/lib/api";
import { FieldError, useValidation } from "./validation";
import { downloadCatalog, dropQueued, findInCatalog, flushQueue, getCatalog, getQueue, isOffline, newRef, queueSale, type QueuedSale } from "@/lib/offlinePos";
import * as v from "@/lib/validators";

type Found = {
  variantId: string; title: string; variant: string; options: Record<string, string>; sku: string | null; imageId: string | null;
  market: { id: string; code: string; currency: string; name: string; taxInclusive: boolean };
  price: number | null; stock: number; tracked: boolean; canSell: boolean;
  locations: { id: string; name: string; isDefault: boolean }[];
};
type Line = Found & { qty: number };
type Sale = { orderId: string; number: number; url?: string; paid?: boolean; terminal?: boolean; total: number; currency: string; expiresInMinutes?: number };
type Status = { paymentStatus: string; status: string };

/**
 * In-store sale on a phone or tablet. Scan one or more product QR codes (or type SKUs) into a basket, add the customer,
 * then take card (a one-off Stripe payment QR the customer scans) or cash. The server sets price, tax and stock.
 */
export function Sell({ code: initial }: { code?: string }) {
  const [code, setCode] = useState("");
  const [basket, setBasket] = useState<Line[]>([]);
  const [err, setErr] = useState("");
  const [loc, setLoc] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [discount, setDiscount] = useState("");
  const [discountNote, setDiscountNote] = useState("");
  const [payWith, setPayWith] = useState<"card" | "cash" | "terminal">("card");
  const [term, setTerm] = useState<{ configured: boolean; simulated: boolean; locationId: string | null } | null>(null);
  const [termMsg, setTermMsg] = useState("");
  const [camera, setCamera] = useState(false);
  const [camErr, setCamErr] = useState("");
  const video = useRef<HTMLVideoElement>(null);
  const lastScan = useRef({ code: "", at: 0 });
  const addRef = useRef<(c: string) => Promise<void>>(async () => {});
  const [busy, setBusy] = useState(false);
  const [sale, setSale] = useState<Sale | null>(null);
  const [qr, setQr] = useState("");
  const [paid, setPaid] = useState(false);
  const [gone, setGone] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const started = useRef(false);
  const [online, setOnline] = useState(true);
  const [queue, setQueue] = useState<QueuedSale[]>([]);
  const [catInfo, setCatInfo] = useState("");
  const [queuedMsg, setQueuedMsg] = useState("");
  const refreshQueue = () => setQueue(getQueue());
  useEffect(() => { api<{ configured: boolean; simulated: boolean; locationId: string | null }>("/terminal/config").then(setTerm).catch(() => {}); }, []);

  // offline support: remember the catalogue, keep a queue of cash sales, sync when the connection is back
  useEffect(() => {
    setOnline(navigator.onLine); refreshQueue();
    const c = getCatalog(); if (c) setCatInfo(`${c.items.length} items saved ${new Date(c.savedAt).toLocaleString()}`);
    const sync = async () => { if (!getQueue().length) return; await flushQueue(); refreshQueue(); };
    const up = () => { setOnline(true); sync(); }, down = () => setOnline(false);
    window.addEventListener("online", up); window.addEventListener("offline", down);
    const t = setInterval(sync, 30_000);
    if (navigator.onLine) { downloadCatalog().then((cat) => setCatInfo(`${cat.items.length} items saved ${new Date(cat.savedAt).toLocaleString()}`)).catch(() => {}); sync(); }
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/pos-sw.js", { scope: "/admin/sell" }).catch(() => {});
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); clearInterval(t); };
  }, []);

  const add = async (raw: string) => {
    const c = raw.trim();
    if (!c) return;
    setErr("");
    try {
      const r = await api<Found>(`/pos/lookup?code=${encodeURIComponent(c)}${basket[0] ? `&market=${basket[0].market.code}` : ""}`);
      if (basket[0] && r.market.id !== basket[0].market.id) return setErr(`That item sells in ${r.market.name}; this basket is for ${basket[0].market.name}. Finish this sale first.`);
      if (!r.canSell) return setErr(`${r.title}${r.variant ? ` (${r.variant})` : ""}: ${r.price == null ? "no price in this market" : "out of stock"}.`);
      setBasket((b) => {
        const hit = b.find((x) => x.variantId === r.variantId);
        if (hit) return b.map((x) => (x === hit ? { ...x, qty: Math.min(99, x.qty + 1) } : x));
        return [...b, { ...r, qty: 1 }];
      });
      setLoc((l) => l || r.locations.find((x) => x.isDefault)?.id || r.locations[0]?.id || "");
      setCode("");
    } catch (e) {
      if (isOffline(e)) {
        // no connection: use the saved catalogue (price and stock as of the last download)
        const hit = findInCatalog(c);
        const cat = getCatalog();
        if (!hit || !cat) return setErr(cat ? `No product with the code "${c}" in the saved catalogue.` : "You're offline and no catalogue is saved on this device yet. Open this screen once with internet.");
        if (basket[0] && basket[0].market.id !== cat.market.id) return setErr("This basket is for a different market.");
        if (!hit.canSell) return setErr(`${hit.title}${hit.variant ? ` (${hit.variant})` : ""}: out of stock.`);
        const r: Found = { variantId: hit.variantId, title: hit.title, variant: hit.variant, options: hit.options, sku: hit.sku, imageId: hit.imageId, market: cat.market, price: hit.price, stock: hit.stock, tracked: hit.tracked, canSell: hit.canSell, locations: cat.locations };
        setBasket((b) => { const same = b.find((x) => x.variantId === r.variantId); return same ? b.map((x) => (x === same ? { ...x, qty: Math.min(99, x.qty + 1) } : x)) : [...b, { ...r, qty: 1 }]; });
        setLoc((l) => l || r.locations.find((x) => x.isDefault)?.id || r.locations[0]?.id || "");
        setCode("");
      } else setErr((e as Error).message);
    }
    input.current?.focus();
  };
  useEffect(() => { if (initial && !started.current) { started.current = true; add(initial); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [initial]);

  const setQty = (id: string, q: number) => setBasket((b) => (q <= 0 ? b.filter((x) => x.variantId !== id) : b.map((x) => (x.variantId === id ? { ...x, qty: Math.min(99, q) } : x))));
  const cur = basket[0]?.market.currency ?? "";
  const subtotal = basket.reduce((a, l) => a + (l.price ?? 0) * l.qty, 0);
  const discMinor = discount.trim() ? toMinor(discount) : 0;
  const errors = {
    name: v.required(name, "Enter the customer's name"),
    email: v.email(email, true),
    phone: v.phone(phone),
    discount: discount.trim() ? v.money(discount, { label: "discount" }) || (discMinor > subtotal ? "The discount is more than the items cost" : "") : "",
  };
  const val = useValidation(errors);
  const over = basket.find((l) => l.tracked && l.qty > l.stock);

  const confirm = async () => {
    if (!basket.length || !val.submit()) return;
    if (over) return setErr(`Only ${over.stock} of ${over.title} in stock.`);
    setBusy(true); setErr("");
    const body = { marketId: basket[0].market.id, items: basket.map((l) => ({ variantId: l.variantId, quantity: l.qty })), locationId: loc || undefined, name, email, phone: phone || undefined, discount: discMinor, discountNote: discountNote || undefined, payWith, ...(payWith === "cash" ? { clientRef: newRef() } : {}) };
    const saveOffline = () => {
      queueSale({ clientRef: body.clientRef!, queuedAt: new Date().toISOString(), summary: `${basket.reduce((a, l) => a + l.qty, 0)} item(s) · ${money(total, cur)} · ${name}`, body });
      refreshQueue(); setQueuedMsg(`Cash sale saved on this device (about ${money(total, cur)}${basket[0].market.taxInclusive ? "" : " plus tax"}). It will sync when the internet is back.`);
      setSale({ orderId: "", number: 0, paid: true, total, currency: cur }); setPaid(true);
    };
    if (payWith !== "cash" && !navigator.onLine) { setBusy(false); return setErr("Card payments need an internet connection. Take cash, or wait until you're back online."); }
    if (payWith === "cash" && !navigator.onLine) { saveOffline(); setBusy(false); return; }
    try {
      const s = await api<Sale>("/pos/sale", { method: "POST", json: body });
      setSale(s);
      if (s.terminal) { void runReader(s); setBusy(false); return; }
      if (s.paid) setPaid(true);
      else if (s.url) setQr(await QRCode.toDataURL(s.url, { margin: 2, width: 420, errorCorrectionLevel: "M" }));
    } catch (e) {
      // the connection dropped mid-sale: a cash sale is kept safely on this device (the server ignores a repeat of the same reference)
      if (payWith === "cash" && isOffline(e)) saveOffline(); else setErr((e as Error).message);
    }
    setBusy(false);
  };

  // card: wait for the Stripe webhook to mark it paid
  useEffect(() => {
    if (!sale || paid || gone || sale.paid || sale.terminal) return;
    const t = setInterval(async () => {
      try {
        const s = await api<Status>(`/pos/sale/${sale.orderId}`);
        if (s.paymentStatus === "paid") setPaid(true);
        else if (s.status === "cancelled") setGone("This payment link expired or was cancelled.");
      } catch { /* keep trying */ }
    }, 3000);
    return () => clearInterval(t);
  }, [sale, paid, gone]);

  // Stripe Terminal: find the reader, collect the card on it, then ask the server to confirm with Stripe.
  const runReader = async (s: Sale) => {
    setTermMsg("Connecting to the card reader…"); setErr("");
    try {
      type Term = { discoverReaders: (c: object) => Promise<{ error?: { message: string }; discoveredReaders?: object[] }>; connectReader: (r: object) => Promise<{ error?: { message: string } }>; collectPaymentMethod: (secret: string) => Promise<{ error?: { message: string }; paymentIntent?: object }>; processPayment: (pi: object) => Promise<{ error?: { message: string } }>; cancelCollectPaymentMethod?: () => Promise<unknown> };
      const w = window as unknown as { StripeTerminal?: { create: (c: object) => Term } };
      if (!w.StripeTerminal) await new Promise<void>((ok, no) => { const el = document.createElement("script"); el.src = "https://js.stripe.com/terminal/v1/"; el.onload = () => ok(); el.onerror = () => no(new Error("Could not load Stripe Terminal. Check the connection.")); document.head.appendChild(el); });
      const t = w.StripeTerminal!.create({ onFetchConnectionToken: async () => (await api<{ secret: string }>("/terminal/connection-token", { method: "POST" })).secret, onUnexpectedReaderDisconnect: () => setErr("The card reader disconnected.") });
      termRef.current = t;
      const found = await t.discoverReaders(term?.simulated ? { simulated: true } : { simulated: false, ...(term?.locationId ? { location: term.locationId } : {}) });
      if (found.error) throw new Error(found.error.message);
      if (!found.discoveredReaders?.length) throw new Error("No card reader found. Switch it on and make sure it is registered in the Stripe Dashboard.");
      const conn = await t.connectReader(found.discoveredReaders[0]);
      if (conn.error) throw new Error(conn.error.message);
      const pi = await api<{ clientSecret: string }>("/terminal/payment-intent", { method: "POST", json: { orderId: s.orderId } });
      setTermMsg("Ask the customer to tap, insert or swipe their card…");
      const col = await t.collectPaymentMethod(pi.clientSecret);
      if (col.error) throw new Error(col.error.message);
      setTermMsg("Processing…");
      const pay = await t.processPayment(col.paymentIntent!);
      if (pay.error) throw new Error(pay.error.message);
      await api("/terminal/confirm", { method: "POST", json: { orderId: s.orderId } });
      setTermMsg(""); setPaid(true);
    } catch (e) { setTermMsg(""); setErr((e as Error).message); }
  };
  const termRef = useRef<{ cancelCollectPaymentMethod?: () => Promise<unknown> } | null>(null);
  const cancelReader = async () => {
    await termRef.current?.cancelCollectPaymentMethod?.().catch(() => {});
    if (sale) await api("/terminal/cancel", { method: "POST", json: { orderId: sale.orderId } }).catch(() => {});
    setSale(null); setTermMsg(""); setErr("");
  };

  const cancel = async () => {
    if (!sale) return;
    await api(`/pos/sale/${sale.orderId}/cancel`, { method: "POST" }).catch(() => {});
    setSale(null); setQr("");
  };
  const reset = () => { setBasket([]); setSale(null); setQr(""); setPaid(false); setGone(""); setQueuedMsg(""); setCode(""); setName(""); setEmail(""); setPhone(""); setDiscount(""); setDiscountNote(""); setPayWith("card"); setErr(""); setTimeout(() => input.current?.focus(), 50); };

  const total = subtotal - Math.min(discMinor, subtotal);
  const locations = basket[0]?.locations ?? [];

  addRef.current = add;
  useEffect(() => {
    if (!camera) return;
    const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
    if (!BD) { setCamErr("This browser can't read codes with the camera. Use a scanner or type the SKU."); setCamera(false); return; }
    let stop = false, stream: MediaStream | null = null;
    const det = new BD({ formats: ["qr_code", "ean_13", "ean_8", "upc_a", "code_128"] });
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }).then((st) => {
      stream = st;
      if (video.current) { video.current.srcObject = st; void video.current.play(); }
      const tick = async () => {
        if (stop) return;
        try {
          const found = video.current ? await det.detect(video.current) : [];
          const v = found[0]?.rawValue;
          if (v && !(v === lastScan.current.code && Date.now() - lastScan.current.at < 2500)) { lastScan.current = { code: v, at: Date.now() }; await addRef.current(v); }
        } catch { /* frame not ready */ }
        setTimeout(tick, 300);
      };
      void tick();
    }).catch(() => { setCamErr("Camera access was blocked."); setCamera(false); });
    return () => { stop = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, [camera]);

  const units = basket.reduce((a, l) => a + l.qty, 0);
  const payLabel = payWith === "cash" ? "Take cash" : payWith === "terminal" ? "Charge on card reader" : "Show payment QR";
  const state = paid ? "paid" : gone ? "gone" : sale ? (sale.terminal ? "reader" : "qr") : "sell";

  return (
    <div className="till">
      <div className="till-head">
        <h1 className="pagetitle">Sell in store</h1>
        <span className={`till-status ${online ? "on" : "off"}`}><i />{online ? "Online" : "Offline"}</span>
      </div>
      {!online && <div className="notice" role="status">You're offline. Cash sales are saved on this device and sync when the internet returns. Card payments need a connection.</div>}
      {queue.length > 0 && (
        <div className="card offlinebox" role="status">
          <b>{queue.length} sale{queue.length === 1 ? "" : "s"} waiting to sync</b>
          <ul>
            {queue.map((q) => <li key={q.clientRef}>{q.summary}{q.error ? <span className="err"> — {q.error} <button className="link" onClick={() => { if (window.confirm("Remove this sale from the device? Make sure you've handled it another way.")) { dropQueued(q.clientRef); refreshQueue(); } }}>Remove</button></span> : null}</li>)}
          </ul>
          {online && <button onClick={async () => { await flushQueue(); refreshQueue(); }}>Sync now</button>}
        </div>
      )}

      {state === "sell" && (
        <div className="till-grid">
          <div className="till-main">
            <div className="card till-scan">
              <form onSubmit={(e) => { e.preventDefault(); add(code); }} className="till-scanrow">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7V5a1 1 0 011-1h2M17 4h2a1 1 0 011 1v2M20 17v2a1 1 0 01-1 1h-2M7 20H5a1 1 0 01-1-1v-2M8 9v6M12 9v6M16 9v6" /></svg>
                <input ref={input} value={code} onChange={(e) => setCode(e.target.value)} placeholder="Scan a QR code or type a SKU" aria-label="SKU or barcode" autoFocus autoComplete="off" />
                <button className="primary" type="submit">Add</button>
                <button type="button" onClick={() => { setCamErr(""); setCamera((c) => !c); }} aria-pressed={camera}>{camera ? "Stop camera" : "Camera"}</button>
              </form>
              {camera && <video ref={video} muted playsInline className="till-video" />}
              {camErr && <p className="err" role="alert">{camErr}</p>}
              {err && <p className="err" role="alert">{err}</p>}
              {catInfo && <p className="muted till-cat">Works offline · catalogue {catInfo}</p>}
            </div>

            <div className="card till-basket">
              <div className="cardhead"><h3>Basket{units ? ` · ${units} item${units === 1 ? "" : "s"}` : ""}</h3>{basket.length > 0 && <button className="link" onClick={reset}>Clear all</button>}</div>
              {basket.length === 0 ? (
                <div className="till-empty"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h2l2 11h11l2-8H6M9 20h.01M17 20h.01" /></svg><b>Nothing in the basket yet</b><span>Scan a product's QR code to add it.</span></div>
              ) : (
                <ul className="sellbasket">
                  {basket.map((l) => {
                    const low = l.tracked && l.qty >= l.stock;
                    return (
                      <li key={l.variantId}>
                        {l.imageId ? <img src={`/uploads/${l.imageId}-thumb.webp`} alt="" width={56} height={56} /> : <i className="ph" aria-hidden="true">{l.title.slice(0, 1)}</i>}
                        <div className="sb-info"><b>{l.title}</b>{l.variant && <span>{l.variant}</span>}<span className={low ? "lowtag" : "muted"}>{l.sku ?? "No SKU"} · {l.tracked ? (low ? `last ${l.stock} in stock` : `${l.stock} in stock`) : "stock not tracked"}</span></div>
                        <div className="sb-qty">
                          <button aria-label={`Fewer ${l.title}`} onClick={() => setQty(l.variantId, l.qty - 1)}>−</button>
                          <span aria-live="polite">{l.qty}</span>
                          <button aria-label={`More ${l.title}`} onClick={() => setQty(l.variantId, l.qty + 1)} disabled={l.tracked && l.qty >= l.stock}>+</button>
                        </div>
                        <b className="sb-price">{money((l.price ?? 0) * l.qty, l.market.currency)}</b>
                        <button className="sb-x" aria-label={`Remove ${l.title}`} onClick={() => setQty(l.variantId, 0)}>×</button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          <aside className="till-side">
            <div className="card till-sum">
              <div className="till-line"><span>Subtotal</span><span>{basket.length ? money(subtotal, cur) : "–"}</span></div>
              <div className="field till-disc"><label htmlFor="s-disc">Discount{cur ? ` (${cur})` : ""}</label><input id="s-disc" inputMode="decimal" placeholder="0.00" value={discount} onChange={(e) => setDiscount(e.target.value)} disabled={!basket.length} {...val.props("discount")} /><FieldError k="discount" msg={val.err("discount")} /></div>
              {discMinor > 0 && <div className="field"><input aria-label="Reason for the discount" value={discountNote} onChange={(e) => setDiscountNote(e.target.value)} placeholder="Reason: Diwali offer, damaged box…" /></div>}
              <div className="till-total"><span>Total</span><b>{basket.length ? money(total, cur) : "–"}</b></div>
              {basket.length > 0 && <p className="muted">{basket[0].market.taxInclusive ? "Tax included." : "Plus tax."} The server works out the final amount.</p>}
            </div>

            <div className="card">
              <h3>Customer</h3>
              <div className="field"><label htmlFor="s-name">Name</label><input id="s-name" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} {...val.props("name")} /><FieldError k="name" msg={val.err("name")} /></div>
              <div className="field"><label htmlFor="s-email">Email (for the receipt)</label><input id="s-email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} {...val.props("email")} /><FieldError k="email" msg={val.err("email")} /></div>
              <div className="field"><label htmlFor="s-phone">Phone (optional)</label><input id="s-phone" inputMode="tel" autoComplete="off" value={phone} onChange={(e) => setPhone(e.target.value)} {...val.props("phone")} /><FieldError k="phone" msg={val.err("phone")} /></div>
              {locations.length > 1 && <div className="field"><label htmlFor="s-loc">Store location</label><select id="s-loc" value={loc} onChange={(e) => setLoc(e.target.value)}>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>}
            </div>

            <div className="card">
              <h3>Payment</h3>
              <div className="till-pay" role="group" aria-label="Payment method">
                <button className={payWith === "card" ? "on" : ""} onClick={() => setPayWith("card")} aria-pressed={payWith === "card"}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18v12H3zM3 10h18" /></svg>Card<small>Customer scans a QR</small></button>
                {term?.configured && <button className={payWith === "terminal" ? "on" : ""} onClick={() => setPayWith("terminal")} aria-pressed={payWith === "terminal"}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h10v18H7zM10 17h4M9 7h6" /></svg>Reader<small>Tap or insert</small></button>}
                <button className={payWith === "cash" ? "on" : ""} onClick={() => setPayWith("cash")} aria-pressed={payWith === "cash"}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h18v10H3zM12 14a2 2 0 100-4 2 2 0 000 4z" /></svg>Cash<small>{online ? "Closes the sale now" : "Saved until online"}</small></button>
              </div>
              {payWith === "terminal" && !online && <p className="err">The card reader needs internet.</p>}
              {err && !basket.length ? null : null}
              <button className="primary till-go" disabled={busy || !basket.length} onClick={confirm}>{busy ? "Working…" : basket.length ? `${payLabel} · ${money(total, cur)}` : "Add items to continue"}</button>
            </div>
          </aside>
        </div>
      )}

      {state !== "sell" && sale && (
        <div className="card till-result">
          {state === "paid" ? (
            <>
              <div className="till-check" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" /></svg></div>
              <h2>{queuedMsg ? "Saved on this device" : "Payment received"}</h2>
              {queuedMsg ? <p>{queuedMsg}</p> : <p>Order <b>#{sale.number}</b> · {money(sale.total, sale.currency)}{payWith === "cash" ? " in cash" : ""}. The receipt is emailed and stock is updated.</p>}
              <button className="primary till-go" onClick={reset}>Start next sale</button>
            </>
          ) : state === "gone" ? (
            <>
              <h2>Payment link closed</h2>
              <p className="err">{gone}</p>
              <button className="primary till-go" onClick={reset}>Start again</button>
            </>
          ) : state === "reader" ? (
            <>
              <h2>Card reader</h2>
              <p className="till-big">{money(sale.total, sale.currency)} <span>order #{sale.number}</span></p>
              {termMsg && <p className="till-wait" role="status"><i />{termMsg}</p>}
              {err && <p className="err" role="alert">{err}</p>}
              <div className="row"><button onClick={cancelReader}>{err ? "Close this sale" : "Cancel"}</button>{err && <button className="primary" onClick={() => runReader(sale)}>Try again</button>}</div>
            </>
          ) : (
            <>
              <h2>Customer scans to pay</h2>
              <p className="till-big">{money(sale.total, sale.currency)} <span>order #{sale.number}</span></p>
              {qr && <img src={qr} alt="Payment QR code" className="till-qr" />}
              <p className="till-wait" role="status"><i />Waiting for payment · valid {sale.expiresInMinutes} minutes</p>
              <button onClick={cancel}>Cancel sale</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
