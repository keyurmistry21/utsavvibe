import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "./db.js";

// One app secret: from APP_SECRET, else generated once and kept in the database (fine for a single deployment;
// set APP_SECRET in production so a database leak alone can't decrypt 2FA secrets).
let key: Buffer | null = null;
export async function loadSecret() {
  let s = process.env.APP_SECRET;
  if (!s) {
    const row = await prisma.setting.findUnique({ where: { key: "appSecret" } });
    s = row?.value ?? randomBytes(32).toString("hex");
    if (!row) await prisma.setting.create({ data: { key: "appSecret", value: s } });
  }
  key = createHash("sha256").update(s).digest();
}
const k = () => {
  if (!key) throw new Error("secrets not loaded");
  return key;
};

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", k(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}

export function decrypt(blob: string): string {
  const [iv, tag, enc] = blob.split(".").map((x) => Buffer.from(x, "base64"));
  const d = createDecipheriv("aes-256-gcm", k(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

/** Signed token for links in emails (unsubscribe). */
export const sign = (v: string) => createHmac("sha256", k()).update(v).digest("base64url").slice(0, 32);

// ---- JWT (HS256) for staff sign-in ----
// The token is signed and expires, and names a server-side session (`sid`). The server still checks that session on every
// request, so signing out, deactivating a user or changing a password revokes a token at once (a bare JWT can't be revoked).
const b64 = (v: Buffer | string) => Buffer.from(v).toString("base64url");
const mac = (data: string) => createHmac("sha256", createHash("sha256").update(k()).update("jwt").digest()).update(data).digest();

export function signJwt(claims: Record<string, unknown>, ttlSeconds: number): string {
  const now = Math.floor(Date.now() / 1000);
  const head = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64(JSON.stringify({ ...claims, iss: "utsavvibe", iat: now, exp: now + ttlSeconds }));
  return `${head}.${body}.${b64(mac(`${head}.${body}`))}`;
}

export function verifyJwt(token: string): Record<string, unknown> | null {
  const [h, b, sig] = token.split(".");
  if (!h || !b || !sig || token.split(".").length !== 3) return null;
  try {
    if ((JSON.parse(Buffer.from(h, "base64url").toString()) as { alg?: string }).alg !== "HS256") return null; // never trust the token's own alg
    const want = mac(`${h}.${b}`);
    const got = Buffer.from(sig, "base64url");
    if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
    const c = JSON.parse(Buffer.from(b, "base64url").toString()) as Record<string, unknown>;
    if (c.iss !== "utsavvibe" || typeof c.exp !== "number" || c.exp < Date.now() / 1000) return null;
    return c;
  } catch {
    return null;
  }
}
