import { storeName } from "./mail.js";

// Templates. Every dynamic value is HTML-escaped: names, addresses and item titles come from customers/staff.
export const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export type EmailOrder = {
  number: number;
  currency: string;
  subtotal: number;
  discount: number;
  discountNote: string | null;
  tax: number;
  shipping: number;
  total: number;
  shippingName: string;
  shippingAddress: string; // JSON
  items: { title: string; quantity: number; unitPrice: number }[];
  customer: { name: string; email: string | null } | null;
  market: { name: string; taxInclusive: boolean; regions: { code: string; name: string }[] };
};

const fmt = (minor: number, currency: string) => new Intl.NumberFormat("en", { style: "currency", currency }).format(minor / 100);
const COLORS = { ink: "#2a1d14", muted: "#7a6a5e", line: "#eadfd3", accent: "#b4491f", bg: "#fff9f1" };

function addressLines(o: EmailOrder): string[] {
  let a: Record<string, string> = {};
  try { a = JSON.parse(o.shippingAddress); } catch {}
  const region = o.market.regions.find((r) => r.code === a.region)?.name ?? a.region;
  return [
    o.shippingName,
    a.company,
    [a.line1, a.line2].filter(Boolean).join(", "),
    [a.city, region, a.postcode].filter(Boolean).join(", "),
    a.country,
  ].filter((x): x is string => !!x && x.trim().length > 0);
}

function layout(opts: { preheader: string; heading: string; intro: string; body: string; cta?: { label: string; url: string } }) {
  const name = esc(storeName());
  const site = process.env.STOREFRONT_URL ?? "";
  const cta = opts.cta
    ? `<p style="margin:24px 0"><a href="${esc(opts.cta.url)}" style="background:${COLORS.accent};color:#ffffff;text-decoration:none;padding:13px 26px;border-radius:999px;font-weight:600;display:inline-block">${esc(opts.cta.label)}</a></p>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:${COLORS.bg};font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:${COLORS.ink}">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(opts.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.bg}"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
<tr><td style="padding:0 4px 16px;font-family:Georgia,serif;font-size:26px;font-weight:700;color:${COLORS.accent}">${name}</td></tr>
<tr><td style="background:#ffffff;border:1px solid ${COLORS.line};border-radius:16px;padding:28px">
<h1 style="margin:0 0 12px;font-size:22px">${esc(opts.heading)}</h1>
<p style="margin:0 0 8px;line-height:1.55;color:${COLORS.ink}">${opts.intro}</p>
${cta}
${opts.body}
</td></tr>
<tr><td style="padding:18px 4px;color:${COLORS.muted};font-size:12px;line-height:1.6">Questions? Just reply to this email.<br>${name}${site ? ` · <a href="${esc(site)}" style="color:${COLORS.muted}">${esc(site.replace(/^https?:\/\//, ""))}</a>` : ""}</td></tr>
</table></td></tr></table></body></html>`;
}

function summary(o: EmailOrder) {
  const row = (l: string, v: string, bold = false) =>
    `<tr><td style="padding:5px 0;color:${bold ? COLORS.ink : COLORS.muted};${bold ? "font-weight:700;" : ""}">${l}</td><td align="right" style="padding:5px 0;${bold ? "font-weight:700;" : ""}">${v}</td></tr>`;
  const items = o.items
    .map((i) => `<tr><td style="padding:10px 0;border-bottom:1px solid ${COLORS.line}">${esc(i.title)}<div style="color:${COLORS.muted};font-size:13px">Qty ${i.quantity} × ${fmt(i.unitPrice, o.currency)}</div></td><td align="right" style="padding:10px 0;border-bottom:1px solid ${COLORS.line};white-space:nowrap">${fmt(i.unitPrice * i.quantity, o.currency)}</td></tr>`)
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px">${items}</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px">
${row("Subtotal", fmt(o.subtotal, o.currency))}
${o.discount > 0 ? row(`Discount${o.discountNote ? ` (${esc(o.discountNote)})` : ""}`, `−${fmt(o.discount, o.currency)}`) : ""}
${row("Shipping", o.shipping ? fmt(o.shipping, o.currency) : "Free")}
${row(o.market.taxInclusive ? "Tax (included)" : "Tax", fmt(o.tax, o.currency))}
<tr><td colspan="2" style="border-top:1px solid ${COLORS.line};padding-top:4px"></td></tr>
${row("Total", `${fmt(o.total, o.currency)} ${esc(o.currency)}`, true)}
</table>`;
}

const addressBlock = (o: EmailOrder) => {
  const lines = addressLines(o);
  if (!lines.length) return "";
  return `<p style="margin:24px 0 4px;font-weight:700">Shipping to</p><p style="margin:0;line-height:1.6;color:${COLORS.muted}">${lines.map(esc).join("<br>")}</p>`;
};

const textSummary = (o: EmailOrder) =>
  [
    ...o.items.map((i) => `- ${i.title} × ${i.quantity}   ${fmt(i.unitPrice * i.quantity, o.currency)}`),
    "",
    `Subtotal: ${fmt(o.subtotal, o.currency)}`,
    o.discount > 0 ? `Discount: -${fmt(o.discount, o.currency)}` : "",
    `Shipping: ${o.shipping ? fmt(o.shipping, o.currency) : "Free"}`,
    `${o.market.taxInclusive ? "Tax (included)" : "Tax"}: ${fmt(o.tax, o.currency)}`,
    `Total: ${fmt(o.total, o.currency)} ${o.currency}`,
    "",
    addressLines(o).length ? `Shipping to:\n${addressLines(o).join("\n")}` : "",
  ].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n");

export function orderConfirmationEmail(o: EmailOrder) {
  const first = (o.customer?.name || o.shippingName || "").split(" ")[0];
  const hi = first ? `Hi ${esc(first)}, thank` : "Thank";
  return {
    subject: `Order #${o.number} confirmed`,
    html: layout({
      preheader: `We’ve received your payment of ${fmt(o.total, o.currency)}.`,
      heading: `Thanks for your order #${o.number}`,
      intro: `${hi} you. We’ve received your payment and we’re getting your order ready. We’ll email you again when it ships.`,
      body: summary(o) + addressBlock(o),
    }),
    text: `Thanks for your order #${o.number}\n\n${textSummary(o)}\n\nQuestions? Just reply to this email.\n${storeName()}`,
  };
}

export function paymentLinkEmail(o: EmailOrder, url: string, expiresInHours = 24) {
  const first = (o.customer?.name || o.shippingName || "").split(" ")[0];
  return {
    subject: `Complete your payment for order #${o.number}`,
    html: layout({
      preheader: `Your order total is ${fmt(o.total, o.currency)}. Pay securely with Stripe.`,
      heading: `Your order #${o.number} is ready for payment`,
      intro: `${first ? `Hi ${esc(first)}, here` : "Here"} is your order. Use the button below to pay securely with Stripe. This link expires in ${expiresInHours} hours.`,
      cta: { label: `Pay ${fmt(o.total, o.currency)}`, url },
      body: summary(o) + addressBlock(o) + `<p style="margin:24px 0 0;color:${COLORS.muted};font-size:13px;line-height:1.55">If the button doesn’t work, copy this link into your browser:<br><span style="word-break:break-all">${esc(url)}</span></p>`,
    }),
    text: `Your order #${o.number} is ready for payment.\n\nPay securely here (link expires in ${expiresInHours} hours):\n${url}\n\n${textSummary(o)}\n\n${storeName()}`,
  };
}

export function testEmail() {
  return {
    subject: `Test email from ${storeName()}`,
    html: layout({ preheader: "Email sending works.", heading: "It works 🎉", intro: "This is a test email from your store admin. Order confirmations and payment links will be sent the same way.", body: "" }),
    text: "This is a test email from your store admin. Email sending works.",
  };
}

export function giftCardEmail(g: { code: string; amount: number; currency: string; expiresAt?: Date | null }) {
  const amount = fmt(g.amount, g.currency);
  const site = process.env.STOREFRONT_URL ?? "";
  const body = `<div style="margin:18px 0;padding:18px;border:2px dashed ${COLORS.accent};border-radius:12px;text-align:center"><div style="color:${COLORS.muted};font-size:12px;text-transform:uppercase;letter-spacing:.08em">Gift card code</div><div style="font-family:Menlo,Consolas,monospace;font-size:24px;font-weight:700;letter-spacing:.08em;margin-top:6px">${esc(g.code)}</div></div><p style="color:${COLORS.muted};font-size:13px;line-height:1.6">Enter this code at checkout to pay. Any balance left stays on the card.${g.expiresAt ? ` Valid until ${esc(g.expiresAt.toLocaleDateString("en", { dateStyle: "long" }))}.` : ""}</p>`;
  const html = layout({ preheader: `Your ${amount} gift card`, heading: `Your ${amount} gift card`, intro: "Here is your gift card. Keep this email safe: anyone with the code can spend the balance.", body, cta: site ? { label: "Start shopping", url: site } : undefined });
  const text = `Your ${amount} gift card\n\nCode: ${g.code}\n\nEnter this code at checkout to pay. Anyone with the code can spend the balance, so keep it safe.${site ? `\n\n${site}` : ""}`;
  return { subject: `Your ${amount} gift card from ${storeName()}`, html, text };
}
