// Minimal RFC 4180 parser (quoted fields, escaped quotes, newlines inside quotes).
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

const norm = (h: string) => h.toLowerCase().replace(/^﻿/, "").replace(/[^a-z0-9]/g, "").replace(/^defaultaddress/, "");
const FIELD: Record<string, string> = {
  firstname: "firstName", lastname: "lastName", email: "email", phone: "phone",
  language: "language", customerlanguage: "language",
  acceptsemailmarketing: "acceptsEmail", emailsubscription: "acceptsEmail", acceptsmarketing: "acceptsEmail",
  acceptssmsmarketing: "acceptsSms", smssubscription: "acceptsSms", acceptswhatsappmarketing: "acceptsWhatsapp", whatsappsubscription: "acceptsWhatsapp",
  taxexempt: "taxExempt", company: "company", address1: "line1", address: "line1", address2: "line2", city: "city",
  provincecode: "region", province: "region", region: "region", state: "region",
  countrycode: "country", country: "country", zip: "postcode", postalcode: "postcode", postcode: "postcode",
  tags: "tags", note: "notes", notes: "notes",
};
const COUNTRY: Record<string, string> = { canada: "CA", unitedstates: "US", usa: "US", unitedstatesofamerica: "US", unitedkingdom: "GB", uk: "GB", england: "GB", greatbritain: "GB" };
const truthy = (v: string) => /^(yes|true|1|y|subscribed)$/i.test(v.trim());

// Works with Shopify's customer export as well as the CSV this app exports.
export function mapCustomerCSV(rows: string[][]) {
  const [head, ...body] = rows;
  const cols = head.map((h) => FIELD[norm(h)] ?? null);
  const mapped = cols.filter(Boolean) as string[];
  const out = body.map((r) => {
    const o: Record<string, unknown> = {};
    r.forEach((raw, i) => {
      const f = cols[i];
      if (!f) return;
      const v = raw.replace(/^'/, "").trim(); // Shopify/our export prefix risky cells with '
      if (!v) return;
      if (f === "acceptsEmail" || f === "acceptsSms" || f === "acceptsWhatsapp" || f === "taxExempt") o[f] = truthy(v);
      else if (f === "tags") o.tags = v.split(",").map((t) => t.trim()).filter(Boolean);
      else if (f === "country") o.country = v.length === 2 ? v.toUpperCase() : COUNTRY[v.toLowerCase().replace(/[^a-z]/g, "")] ?? "";
      else o[f] = v;
    });
    return o;
  });
  return { rows: out, mapped: Array.from(new Set(mapped)), unmapped: head.filter((_, i) => !cols[i]) };
}
