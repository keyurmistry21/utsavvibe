"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { addressFrom, api, blankAddress, hasAddress, money, toMajor, toMinor, type Address, type Customer, type CustHit, type Market, type Order, type Product } from "@/lib/api";
import { countryName } from "@/lib/countries";
import { decimal, int, maxLen, money as moneyErr, required } from "@/lib/validators";
import { FieldError, useValidation } from "./validation";
import { AddressModal } from "./AddressModal";
import { CustomerPicker } from "./CustomerPicker";
import { Modal } from "./Modal";
import { NewCustomerSheet } from "./NewCustomerSheet";
import { ProductPicker, type Picked } from "./ProductPicker";
import { ArrowLeft, Plus } from "../Icons";
import { Select } from "../Select";

// variantId absent = custom item (not in the catalog, no stock tracking)
type Line = { variantId?: string; title: string; quantity: number; price: string; taxable?: boolean; physical?: boolean; weightG?: number };
type Quote = { region: string | null; currency: string; taxInclusive: boolean; taxRateBps: number; subtotal: number; discount: number; tax: number; shipping: number; total: number };
type Picked_ = { id: string; name: string; email: string | null; phone: string | null; taxExempt: boolean };
type CustomForm = { title: string; price: string; qty: string; taxable: boolean; physical: boolean; weight: string; unit: keyof typeof UNIT_G };
const UNIT_G = { kg: 1000, g: 1, lb: 453.592, oz: 28.3495 } as const;
const blankCustom = (): CustomForm => ({ title: "", price: "", qty: "1", taxable: true, physical: true, weight: "", unit: "kg" });

export function DraftEditor({ id }: { id?: string }) {
  const router = useRouter();
  const [markets, setMarkets] = useState<Market[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [marketId, setMarketId] = useState("");
  const [customer, setCustomer] = useState<Picked_ | null>(null);
  const [addr, setAddr] = useState<Address>(blankAddress());
  const [addrOpen, setAddrOpen] = useState(false);
  const [newCust, setNewCust] = useState<string | null>(null); // query text when the "New customer" page is open
  const [lines, setLines] = useState<Line[]>([]);
  const [picker, setPicker] = useState(false);
  const [custom, setCustom] = useState<CustomForm | null>(null);
  const [showDiscount, setShowDiscount] = useState(false);
  const [showShip, setShowShip] = useState(false);
  const [shipRateId, setShipRateId] = useState("");
  const [customShip, setCustomShip] = useState("");
  const [discount, setDiscount] = useState("");
  const [discountNote, setDiscountNote] = useState("");
  const [notes, setNotes] = useState("");
  const [showNotes, setShowNotes] = useState(false);
  const [tags, setTags] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const market = markets.find((m) => m.id === marketId);
  const regionName = market?.regions.find((r) => r.code === addr.region)?.name;

  useEffect(() => {
    Promise.all([api<Market[]>("/markets"), api<Product[]>("/products")]).then(([m, p]) => {
      const active = m.filter((x) => x.active);
      setMarkets(active);
      setProducts(p);
      // new orders start in the first market so the currency shows straight away
      if (!id) setMarketId((cur) => cur || active[0]?.id || "");
    }).catch((e) => setErr(e.message));
  }, [id]);

  // editing an existing draft: prefill
  useEffect(() => {
    if (!id) return;
    api<Order>(`/orders/${id}`).then((o) => {
      setMarketId(o.market.id);
      setCustomer(o.customer ? { id: o.customer.id, name: o.customer.name, email: o.customer.email, phone: o.customer.phone ?? null, taxExempt: !!o.customer.taxExempt } : null);
      setAddr(addressFrom(o.shippingAddress as Record<string, string>));
      setLines(o.items.map((i) => ({ variantId: i.variantId ?? undefined, title: i.title, quantity: i.quantity, price: toMajor(i.unitPrice), taxable: i.taxable, physical: i.physical, weightG: i.weightG })));
      setCustomShip(toMajor(o.shipping));
      setShowShip(true);
      setDiscount(o.discount ? toMajor(o.discount) : "");
      setShowDiscount(o.discount > 0);
      setDiscountNote(o.discountNote ?? "");
      setNotes(o.notes);
      setShowNotes(!!o.notes);
      setTags(o.tags.join(", "));
    }).catch((e) => setErr(e.message));
  }, [id]);

  // delivery country decides the market while nothing has been priced yet
  useEffect(() => {
    if (!addr.country || lines.length) return;
    const m = markets.find((x) => x.countries.includes(addr.country));
    if (m && m.id !== marketId) setMarketId(m.id);
  }, [addr.country, markets]);

  const body = () => ({
    marketId,
    customerId: customer?.id ?? null,
    items: lines.map((l) => (l.variantId ? { variantId: l.variantId, quantity: l.quantity, unitPrice: toMinor(l.price) } : { title: l.title, quantity: l.quantity, unitPrice: toMinor(l.price), taxable: l.taxable ?? true, physical: l.physical ?? true, weightG: l.weightG ?? 0 })),
    address: hasAddress(addr) || addr.country ? Object.fromEntries(Object.entries(addr).map(([k, v]) => [k, v || undefined]).filter(([k, v]) => v || k === "line1" || k === "city" || k === "postcode" || k === "country")) : { line1: "", city: "", postcode: "", country: "" },
    shippingRateId: shipRateId || undefined,
    customShipping: customShip !== "" ? toMinor(customShip) : undefined,
    discount: toMinor(discount),
    discountNote: discountNote || undefined,
    notes,
    tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
  });

  // live totals from the server (same rules as checkout); only needs a market and products
  useEffect(() => {
    if (!marketId || !lines.length) return setQuote(null);
    const t = setTimeout(() => {
      api<Quote>("/drafts/quote", { method: "POST", json: body() }).then((q) => { setQuote(q); setErr(""); }).catch((e) => { setQuote(null); setErr(e.message); });
    }, 350);
    return () => clearTimeout(t);
  }, [marketId, lines, addr.region, addr.country, customer?.id, shipRateId, customShip, discount]);

  const pickCustomer = (c: CustHit) => {
    setCustomer({ id: c.id, name: c.name, email: c.email, phone: c.phone, taxExempt: c.taxExempt });
    if (c.address) setAddr(addressFrom(c.address));
  };
  const customerCreated = (c: Customer) => {
    setCustomer({ id: c.id, name: c.name, email: c.email, phone: c.phone, taxExempt: c.taxExempt });
    if (c.address) setAddr(addressFrom(c.address as unknown as Record<string, string>));
    setNewCust(null);
  };

  const changeMarket = (next: string) => {
    if (next === marketId) return;
    if (lines.length && !confirm("Changing the market clears the items, because prices differ per market. Continue?")) return;
    setMarketId(next); setLines([]); setShipRateId(""); setCustomShip("");
  };

  const imageFor = (variantId: string) => products.find((p) => p.variants.some((v) => v.id === variantId))?.images?.[0]?.thumbUrl;

  const addPicked = (items: Picked[]) => {
    setLines((ls) => {
      const next = [...ls];
      for (const it of items) {
        const hit = next.findIndex((l) => l.variantId === it.variantId);
        if (hit >= 0) next[hit] = { ...next[hit], quantity: next[hit].quantity + 1 }; // already in the order: bump quantity
        else next.push({ variantId: it.variantId, title: it.title, quantity: 1, price: toMajor(it.price) });
      }
      return next;
    });
    setPicker(false);
  };

  const addCustom = () => {
    if (!custom || !cval.submit()) return;
    const weightG = custom.physical && custom.weight ? Math.round(parseFloat(custom.weight) * UNIT_G[custom.unit]) : 0;
    setLines((ls) => [...ls, { title: custom.title.trim(), quantity: Math.max(1, parseInt(custom.qty || "1")), price: custom.price, taxable: custom.taxable, physical: custom.physical, weightG }]);
    setCustom(null);
  };

  // inline validation: order lines, discount, custom shipping
  const subtotalMinor = lines.reduce((t, l) => t + toMinor(l.price) * l.quantity, 0);
  const L: Record<string, string> = {};
  lines.forEach((l, i) => { L[`lprice:${i}`] = moneyErr(l.price, { label: "unit price" }); });
  L.discount = moneyErr(discount, { required: false, label: "discount" }) || (subtotalMinor > 0 && toMinor(discount) > subtotalMinor ? "The discount can't be more than the order subtotal" : "");
  L.ship = moneyErr(customShip, { required: false, label: "shipping amount" });
  const val = useValidation(L);
  // custom item dialog
  const CE: Record<string, string> = custom
    ? { title: required(custom.title, "Enter an item name") || maxLen(custom.title, 190, "The item name"), price: moneyErr(custom.price, { label: "price" }), qty: int(custom.qty, 1, 999, "quantity"), weight: custom.physical ? decimal(custom.weight, 100000, "weight") : "" }
    : {};
  const cval = useValidation(CE);
  const openCustom = () => { cval.reset(); setCustom(blankCustom()); };

  const save = async () => {
    if (L.discount) setShowDiscount(true);
    if (L.ship) setShowShip(true);
    if (!val.submit()) { setErr("Some fields need attention. They are highlighted below."); return; }
    setErr(""); setSaving(true);
    try {
      const o = await api<Order>(id ? `/drafts/${id}` : "/drafts", { method: id ? "PUT" : "POST", json: body() });
      router.push(`/admin/orders/${o.id}`);
    } catch (e) {
      setErr((e as Error).message);
      setSaving(false);
    }
  };

  const canSave = !!marketId && lines.length > 0 && !saving;
  const cur = market?.currency ?? "USD";
  const localSubtotal = lines.reduce((s, l) => s + toMinor(l.price) * l.quantity, 0);
  const has = lines.length > 0;
  const needsRegion = !!market?.regions.length && !addr.region;
  const addButtons = (
    <div className="cardactions">
      <button disabled={!market} onClick={() => setPicker(true)}><Plus />Product</button>
      <button disabled={!market} onClick={() => openCustom()}><Plus />Custom item</button>
    </div>
  );

  // New customer replaces this page in the main panel; all the order state above is kept while it is open
  if (newCust !== null) return <NewCustomerSheet markets={markets} query={newCust} backLabel={id ? "Edit draft order" : "Create order"} onCreated={customerCreated} onClose={() => setNewCust(null)} />;

  return (
    <>
      <div className="crumbbar">
        <Link href="/admin/orders?status=draft" className="crumb"><ArrowLeft />Drafts</Link>
      </div>
      <div className="pagehead">
        <h2>{id ? "Edit draft order" : "Create order"}</h2>
        <button className="primary" disabled={!canSave} onClick={save}>{saving ? "Saving…" : "Save draft"}</button>
      </div>
      {err && <div className="error">{err}</div>}

      <div className="cols">
        <div>
          <h3 className="sec2">Products</h3>
          {!has ? (
            <div className="dashbox">{addButtons}{!market && <span className="muted">Select a market first</span>}</div>
          ) : (
            <div className="card">
              <div className="cardhead"><span /> {addButtons}</div>
              {lines.map((l, i) => {
                const img = l.variantId ? imageFor(l.variantId) : undefined;
                return (
                  <div key={i} className="lineitem">
                    {img ? <img className="listthumb" src={img} alt="" /> : <span className="listthumb noimg" />}
                    <div className="lt">
                      <div>{l.title}</div>
                      {!l.variantId && (
                        <div className="lbadges">
                          <span className="badge">Custom item</span>
                          {l.taxable === false && <span className="badge">Not taxable</span>}
                          {l.physical === false ? <span className="badge">No shipping</span> : !!l.weightG && <span className="badge">{l.weightG >= 1000 ? `${(l.weightG / 1000).toFixed(2).replace(/\.?0+$/, "")} kg` : `${l.weightG} g`}</span>}
                        </div>
                      )}
                    </div>
                    <div className="field"><label>Unit price ({cur})</label><input type="number" step="0.01" min={0} value={l.price} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} {...val.props(`lprice:${i}`)} /><FieldError small k={`lprice:${i}`} msg={val.err(`lprice:${i}`)} /></div>
                    <div className="field"><label>Qty</label><input type="number" min={1} value={l.quantity} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, quantity: Math.max(1, +e.target.value) } : x)))} /></div>
                    <div className="lsum">{money(toMinor(l.price) * l.quantity, cur)}</div>
                    <button className="link" aria-label={`Remove ${l.title}`} onClick={() => setLines(lines.filter((_, j) => j !== i))}>✕</button>
                  </div>
                );
              })}
            </div>
          )}

          <h3 className="sec2">Payment</h3>
          <div className="card payment">
            <div className="payrow"><span>Subtotal</span><span>{money(quote?.subtotal ?? localSubtotal, cur)}</span></div>
            <div className="payrow">
              <button className={`link soft ${has ? "" : "dim"}`} onClick={() => setShowDiscount((v) => !v)}>{discount && toMinor(discount) > 0 ? "Discount" : "Add discount"}</button>
              <span>{quote && quote.discount > 0 ? `−${money(quote.discount, cur)}` : money(0, cur)}</span>
            </div>
            {showDiscount && (
              <div className="row payedit">
                <div className="field"><label>Amount ({cur})</label><input type="number" step="0.01" min={0} value={discount} onChange={(e) => setDiscount(e.target.value)} {...val.props("discount")} /><FieldError k={"discount"} msg={val.err("discount")} /></div>
                <div className="field"><label>Reason</label><input value={discountNote} onChange={(e) => setDiscountNote(e.target.value)} placeholder="e.g. Friends & family" /></div>
              </div>
            )}
            <div className="payrow">
              <button className={`link soft ${has ? "" : "dim"}`} onClick={() => setShowShip((v) => !v)}>{customShip !== "" || shipRateId ? "Shipping or delivery" : "Add shipping or delivery"}</button>
              <span>{money(quote?.shipping ?? 0, cur)}</span>
            </div>
            {showShip && (
              <div className="row payedit">
                <div className="field"><label>Rate</label>
                  <Select value={shipRateId} disabled={!market} onChange={(e) => { setShipRateId(e.target.value); setCustomShip(""); }}>
                    <option value="">{market?.shippingRates[0] ? `Default: ${market.shippingRates[0].name}` : "—"}</option>
                    {market?.shippingRates.map((r) => <option key={r.id} value={r.id}>{r.name} · {money(r.amount, market.currency)}</option>)}
                  </Select>
                </div>
                <div className="field"><label>Or custom amount ({cur})</label><input type="number" step="0.01" min={0} placeholder="0 for free" value={customShip} onChange={(e) => setCustomShip(e.target.value)} {...val.props("ship")} /><FieldError k={"ship"} msg={val.err("ship")} /></div>
              </div>
            )}
            <div className={`payrow ${has ? "" : "dim"}`}>
              <span>{quote?.taxInclusive ? "Tax (included)" : "Estimated tax"}{" "}<span className="info" title="Tax is worked out from the delivery address. Add the customer’s address for the exact amount.">ⓘ</span>{customer?.taxExempt ? " · exempt" : quote ? ` · ${market?.regions.find((r) => r.code === quote.region)?.name ?? ""} ${quote.taxRateBps / 100}%`.replace("  ", " ") : ""}</span>
              <span>{quote ? money(quote.tax, cur) : "Not calculated"}</span>
            </div>
            <div className="payrow total"><span>Total</span><span>{money(quote?.total ?? 0, cur)}{market ? ` ${market.currency}` : ""}</span></div>
            <div className="paynote">
              {!has
                ? "Add a product to calculate total and view payment options"
                : needsRegion
                  ? `Tax is estimated at the ${market!.name} default rate. Add the customer’s ${market!.code === "US" ? "state" : "province"} for exact tax.`
                  : "Save the draft, then send a Stripe payment link or mark it as paid."}
            </div>
          </div>
        </div>

        <aside className="sideform">
          <div className="sidesec">
            <div className="sidehead"><span>Notes</span><button className="iconbtn" aria-label="Toggle notes" onClick={() => setShowNotes((v) => !v)}>{showNotes ? "−" : "+"}</button></div>
            {showNotes && <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Private notes, not shown to the customer" />}
          </div>

          <div className="sidesec">
            <div className="sidehead"><span>Customer</span>{customer && <button className="iconbtn" aria-label="Remove customer" onClick={() => { setCustomer(null); setAddr(blankAddress()); }}>✕</button>}</div>
            {!customer ? (
              <CustomerPicker onPick={pickCustomer} onCreate={(q) => setNewCust(q)} />
            ) : (
              <div className="custcard">
                <Link className="lnk" href="/admin/customers">{customer.name || customer.email || customer.phone}</Link>
                {customer.email && <div className="muted">{customer.email}</div>}
                {customer.phone && <div className="muted">{customer.phone}</div>}
                {customer.taxExempt && <span className="badge">Tax exempt</span>}
                <div className="addrblock">
                  <div className="sidehead"><span>Shipping address</span><button className="link" onClick={() => setAddrOpen(true)}>{hasAddress(addr) ? "Edit" : "Add"}</button></div>
                  {hasAddress(addr) ? (
                    <div className="addrlines">
                      {(addr.firstName || addr.lastName) && <div>{`${addr.firstName} ${addr.lastName}`.trim()}</div>}
                      {addr.company && <div>{addr.company}</div>}
                      <div>{addr.line1}{addr.line2 ? `, ${addr.line2}` : ""}</div>
                      <div>{addr.city}{regionName ? `, ${regionName}` : addr.region ? `, ${addr.region}` : ""} {addr.postcode}</div>
                      <div>{addr.country ? countryName(addr.country) : ""}</div>
                    </div>
                  ) : <div className="muted">No shipping address</div>}
                </div>
              </div>
            )}
          </div>

          <div className="sidesec">
            <div className="sidehead"><span>Market</span></div>
            <Select value={marketId} disabled={!!id} onChange={(e) => changeMarket(e.target.value)}>
              {markets.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.currency})</option>)}
            </Select>
            <div className="muted">Sets currency, tax and shipping.{id ? " Locked on saved drafts." : ""}</div>
          </div>

          <div className="sidesec">
            <div className="sidehead"><span>Tags</span></div>
            <input value={tags} placeholder="Comma separated" onChange={(e) => setTags(e.target.value)} />
          </div>
        </aside>
      </div>

      {picker && market && (
        <ProductPicker products={products} market={market} inOrder={new Set(lines.map((l) => l.variantId).filter(Boolean) as string[])} onAdd={addPicked} onClose={() => setPicker(false)} />
      )}
      {addrOpen && (
        <AddressModal
          title="Shipping address"
          initial={hasAddress(addr) || addr.country ? addr : { ...blankAddress(), country: market?.countries[0] ?? "", firstName: customer?.name.split(" ")[0] ?? "", lastName: customer?.name.split(" ").slice(1).join(" ") ?? "", phone: customer?.phone ?? "" }}
          markets={markets}
          onSave={(a) => { setAddr(a); setAddrOpen(false); }}
          onClose={() => setAddrOpen(false)}
        />
      )}
      {custom && (
        <Modal
          title="Add custom item"
          onClose={() => setCustom(null)}
          footer={
            <>
              <span className="muted">Not tracked in inventory.</span>
              <span style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setCustom(null)}>Cancel</button>
                <button className="primary" onClick={addCustom}>Add item</button>
              </span>
            </>
          }
        >
          <div className="field"><label>Item name</label><input autoFocus value={custom.title} onChange={(e) => setCustom({ ...custom, title: e.target.value })} onKeyDown={(e) => e.key === "Enter" && addCustom()} {...cval.props("title")} /><FieldError k={"title"} msg={cval.err("title")} /></div>
          <div className="row">
            <div className="field"><label>Price ({cur})</label><input type="number" step="0.01" min={0} placeholder="0.00" value={custom.price} onChange={(e) => setCustom({ ...custom, price: e.target.value })} onKeyDown={(e) => e.key === "Enter" && addCustom()} {...cval.props("price")} /><FieldError k={"price"} msg={cval.err("price")} /></div>
            <div className="field"><label>Quantity</label><input type="number" min={1} value={custom.qty} onChange={(e) => setCustom({ ...custom, qty: e.target.value })} {...cval.props("qty")} /><FieldError k={"qty"} msg={cval.err("qty")} /></div>
          </div>
          <label className="check"><input type="checkbox" checked={custom.taxable} onChange={(e) => setCustom({ ...custom, taxable: e.target.checked })} />Item is taxable</label>
          <label className="check"><input type="checkbox" checked={custom.physical} onChange={(e) => setCustom({ ...custom, physical: e.target.checked })} />Item is a physical product</label>
          {custom.physical && (
            <>
              <div className="row" style={{ marginTop: 8 }}>
                <div className="field"><label>Item weight (optional)</label><input type="number" min={0} step="0.001" placeholder="0" value={custom.weight} onChange={(e) => setCustom({ ...custom, weight: e.target.value })} {...cval.props("weight")} /><FieldError k={"weight"} msg={cval.err("weight")} /></div>
                <div className="field"><label>Weight unit</label>
                  <Select value={custom.unit} onChange={(e) => setCustom({ ...custom, unit: e.target.value as CustomForm["unit"] })}>
                    <option value="kg">kg</option><option value="g">g</option><option value="lb">lb</option><option value="oz">oz</option>
                  </Select>
                </div>
              </div>
              <p className="muted">Used to calculate shipping rates accurately.</p>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
