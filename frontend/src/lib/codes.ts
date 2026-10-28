// SKU + barcode helpers. Barcodes follow GS1: EAN-13 / UPC-A / EAN-8 / GTIN-14 end in a check digit.

/** GS1 check digit for the digits that come before it (works for 7, 11, 12 and 13 digit bodies). */
export const checkDigit = (body: string) => {
  let sum = 0;
  for (let i = 0; i < body.length; i++) sum += Number(body[body.length - 1 - i]) * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10;
};

/** New EAN-13 for in-store use. Prefix 2 is the GS1 range reserved for internal numbers, so it never clashes with a real product. */
export const makeEan13 = () => {
  const a = new Uint32Array(3);
  crypto.getRandomValues(a);
  const body = "2" + String(a[0] % 1e6).padStart(6, "0") + String(a[1] % 1e5).padStart(5, "0");
  return body + checkDigit(body);
};

/** "" when fine. Numeric barcodes of a standard length must have a correct check digit; other text is allowed (Code 128, ISBN-10, internal labels). */
export const barcodeError = (v: string) => {
  const t = v.trim();
  if (!t) return "";
  if (t.length > 64) return "The barcode is too long (max 64 characters)";
  if (/^\d+$/.test(t) && [8, 12, 13, 14].includes(t.length)) {
    const want = checkDigit(t.slice(0, -1));
    if (Number(t[t.length - 1]) !== want) return `Check digit is wrong: a ${t.length}-digit barcode starting ${t.slice(0, -1)} must end in ${want}`;
  }
  return "";
};

const word = (s: string, n: number) => s.normalize("NFKD").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, n);

/** UV-BRASSBOWL-M-RED style SKU: product name + each option value, made unique against `taken` (lower-case set). */
export const makeSku = (title: string, options: Record<string, string>, taken: Set<string>) => {
  const parts = ["UV", word(title.split(/\s+/).slice(0, 2).join(""), 10) || "ITEM", ...Object.values(options).map((o) => word(o, 4)).filter(Boolean)];
  const base = parts.join("-").slice(0, 58);
  let sku = base, n = 1;
  while (taken.has(sku.toLowerCase())) sku = `${base}-${++n}`;
  return sku;
};

// ---- EAN-13 / UPC-A drawing ----
const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"];
const R = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"];
const FIRST = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];

/** 13-digit module string (95 modules), or null when the value can't be drawn as EAN-13/UPC-A. */
export const ean13Modules = (value: string) => {
  let v = value.trim();
  if (/^\d{12}$/.test(v)) v = "0" + v; // UPC-A is an EAN-13 with a leading 0
  if (!/^\d{13}$/.test(v) || barcodeError(v)) return null;
  const d = [...v].map(Number);
  const pat = FIRST[d[0]];
  let m = "101";
  for (let i = 0; i < 6; i++) m += (pat[i] === "L" ? L : G)[d[i + 1]];
  m += "01010";
  for (let i = 0; i < 6; i++) m += R[d[i + 7]];
  return { digits: v, modules: m + "101" };
};

/** Standalone SVG markup (for display and download). */
export const ean13Svg = (value: string, scale = 3) => {
  const e = ean13Modules(value);
  if (!e) return null;
  const q = 9, h = 90, w = (95 + q * 2) * scale;
  const bars: string[] = [];
  for (let i = 0; i < e.modules.length; i++) {
    if (e.modules[i] !== "1") continue;
    let j = i; while (e.modules[j + 1] === "1") j++;
    bars.push(`<rect x="${(q + i) * scale}" y="0" width="${(j - i + 1) * scale}" height="${h}"/>`);
    i = j;
  }
  const d = e.digits, fs = 13 * scale / 3, ty = h + fs + 2;
  const txt = (x: number, s: string) => `<text x="${x * scale}" y="${ty}" font-family="monospace" font-size="${fs}" text-anchor="middle" letter-spacing="${scale * 1.5}">${s}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${ty + 6}" width="${w}" height="${ty + 6}"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">${bars.join("")}</g><g fill="#000">${txt(q - 4, d[0])}${txt(q + 3 + 21, d.slice(1, 7))}${txt(q + 50 + 21, d.slice(7))}</g></svg>`;
};

/** What a QR code on a label contains: a link phones open to the product page (SKU or barcode is looked up on the server). */
export const productQrUrl = (base: string, code: string) => `${base.replace(/\/$/, "")}/p/${encodeURIComponent(code.trim())}`;
