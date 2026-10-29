import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// RFC 6238 TOTP (SHA-1, 6 digits, 30 s): works with Google Authenticator, 1Password, Authy, etc.
const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function newSecret(): string {
  const b = randomBytes(20);
  let bits = "";
  for (const x of b) bits += x.toString(2).padStart(8, "0");
  return bits.match(/.{5}/g)!.map((c) => ALPHA[parseInt(c, 2)]).join("");
}

function decode(s: string): Buffer {
  let bits = "";
  for (const ch of s.replace(/=+$/, "").toUpperCase()) bits += ALPHA.indexOf(ch).toString(2).padStart(5, "0");
  return Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
}

function code(secret: string, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", decode(secret)).update(buf).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, "0");
}

/** Accepts the previous, current and next 30 s window (clock drift). */
export function verifyTotp(secret: string, token: string): boolean {
  const t = token.replace(/\s/g, "");
  if (!/^\d{6}$/.test(t)) return false;
  const now = Math.floor(Date.now() / 30000);
  return [-1, 0, 1].some((d) => {
    const a = Buffer.from(code(secret, now + d));
    return timingSafeEqual(a, Buffer.from(t));
  });
}

export const otpauthUri = (secret: string, email: string, issuer: string) =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
