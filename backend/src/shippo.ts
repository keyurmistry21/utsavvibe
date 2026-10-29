// Thin Shippo REST client (https://docs.goshippo.com). Used only for buying carrier postage; no card or bank data touches this app:
// postage is billed to the payment method on the Shippo account. SHIPPO_API_URL exists so tests can point at a local fake.
const base = () => (process.env.SHIPPO_API_URL || "https://api.goshippo.com").replace(/\/$/, "");
export const shippoConfigured = () => !!process.env.SHIPPO_API_KEY;

export type Addr = { name: string; company?: string; street1: string; street2?: string; city: string; state?: string; zip: string; country: string; phone?: string; email?: string };
export type Parcel = { length: number; width: number; height: number; distance_unit: "cm"; weight: number; mass_unit: "g" };
export type Rate = { id: string; carrier: string; service: string; amount: number; currency: string; days: number | null };

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  if (!shippoConfigured()) throw Object.assign(new Error("SHIPPO_API_KEY not set. Add it to backend/.env to buy postage."), { status: 400 });
  let r: Response;
  try {
    r = await fetch(`${base()}${path}`, { method, headers: { authorization: `ShippoToken ${process.env.SHIPPO_API_KEY}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000) });
  } catch (e) {
    throw Object.assign(new Error(`Could not reach Shippo: ${(e as Error).message}`), { status: 502 });
  }
  const j = (await r.json().catch(() => ({}))) as any;
  if (!r.ok) throw Object.assign(new Error(shippoMessage(j) || `Shippo error ${r.status}`), { status: r.status === 401 || r.status === 403 ? 502 : 400 });
  return j as T;
}

/** Shippo reports problems as {detail}, {messages:[{text}]} or field maps; surface something readable. */
function shippoMessage(j: any): string {
  if (!j) return "";
  if (typeof j.detail === "string") return j.detail;
  if (Array.isArray(j.messages) && j.messages.length) return j.messages.map((m: any) => m.text ?? m).join(" ");
  const first = Object.values(j).find((v) => Array.isArray(v) && v.length) as unknown[] | undefined;
  return first ? String(first[0]) : "";
}

export type Customs = { signer: string; items: { description: string; quantity: number; weightG: number; value: number; currency: string; originCountry: string }[] };

export async function getRates(o: { from: Addr; to: Addr; parcel: Parcel; customs?: Customs }): Promise<Rate[]> {
  let customsId: string | undefined;
  if (o.customs) {
    const items: string[] = [];
    for (const i of o.customs.items) {
      const it = await call<{ object_id: string }>("POST", "/customs/items/", { description: i.description.slice(0, 100), quantity: i.quantity, net_weight: String(Math.max(1, i.weightG)), mass_unit: "g", value_amount: (i.value / 100).toFixed(2), value_currency: i.currency, origin_country: i.originCountry });
      items.push(it.object_id);
    }
    const d = await call<{ object_id: string }>("POST", "/customs/declarations/", { contents_type: "MERCHANDISE", non_delivery_option: "RETURN", certify: true, certify_signer: o.customs.signer.slice(0, 80), items, incoterm: "DDU" });
    customsId = d.object_id;
  }
  const s = await call<{ rates?: any[]; messages?: unknown[] }>("POST", "/shipments/", { address_from: o.from, address_to: o.to, parcels: [o.parcel], ...(customsId ? { customs_declaration: customsId } : {}), async: false });
  const rates = (s.rates ?? []).map((r) => ({ id: String(r.object_id), carrier: String(r.provider), service: String(r.servicelevel?.name ?? ""), amount: Math.round(parseFloat(r.amount) * 100), currency: String(r.currency), days: r.estimated_days ?? null }));
  if (!rates.length) throw Object.assign(new Error(shippoMessage(s) || "No carrier offered a rate for this parcel and address"), { status: 400 });
  return rates.sort((a, b) => a.amount - b.amount);
}

export async function buyLabel(rateId: string) {
  const rate = await call<any>("GET", `/rates/${encodeURIComponent(rateId)}`);
  const t = await call<any>("POST", "/transactions/", { rate: rateId, label_file_type: "PDF_4x6", async: false });
  if (t.status !== "SUCCESS" || !/^https:\/\//.test(String(t.label_url))) throw Object.assign(new Error(shippoMessage(t) || "The carrier did not issue a label"), { status: 400 });
  return {
    id: String(t.object_id), labelUrl: String(t.label_url), trackingNumber: String(t.tracking_number ?? ""), trackingUrl: t.tracking_url_provider ? String(t.tracking_url_provider) : null,
    carrier: String(rate.provider), cost: Math.round(parseFloat(rate.amount) * 100), currency: String(rate.currency),
  };
}

export async function voidLabel(transactionId: string) {
  await call("POST", "/refunds/", { transaction: transactionId, async: false });
}
