import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { Request, RequestHandler, Response } from "express";
import { prisma } from "./db.js";
import { has, permsOf, type Perms } from "./permissions.js";
import { signJwt, verifyJwt } from "./secrets.js";

export const COOKIE = "uv_session";
const SESSION_MS = 7 * 24 * 3600 * 1000;

const scryptAsync = (pw: string, salt: Buffer) =>
  new Promise<Buffer>((resolve, reject) => scrypt(pw, salt, 64, (e, k) => (e ? reject(e) : resolve(k))));

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${(await scryptAsync(pw, salt)).toString("hex")}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [saltHex, keyHex] = stored.split(":");
  if (!saltHex || !keyHex) return false;
  const key = Buffer.from(keyHex, "hex");
  const got = await scryptAsync(pw, Buffer.from(saltHex, "hex"));
  return got.length === key.length && timingSafeEqual(got, key);
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const secure = () => process.env.NODE_ENV === "production";

export async function createSession(res: Response, userId: string) {
  // JWT in an httpOnly cookie (JS can't read it). Its `sid` points at a session row we can delete to revoke it.
  const sid = randomBytes(16).toString("hex");
  const token = signJwt({ sub: userId, sid }, SESSION_MS / 1000);
  const expiresAt = new Date(Date.now() + SESSION_MS);
  await prisma.session.create({ data: { id: sid, tokenHash: sha(token), userId, expiresAt } });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: secure(), expires: expiresAt, path: "/" });
}

/** A staff/customer JWT sent as `Authorization: Bearer <jwt>` (the web proxy adds it from the cookie), else the cookie itself. API keys (`uvk_`) are separate. */
export function sessionToken(req: Request, cookieName: string): string | undefined {
  const m = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(req.header("authorization") ?? "");
  return m?.[1] ?? readCookie(req, cookieName);
}
export const usesApiKey = (req: Request) => /^Bearer uvk_/.test(req.header("authorization") ?? "");

export function readCookie(req: Request, name: string): string | undefined {
  const raw = req.header("cookie");
  if (!raw) return;
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
}

export async function currentUser(req: Request) {
  const token = sessionToken(req, COOKIE);
  const claims = token ? verifyJwt(token) : null;
  if (!token || !claims) return null;
  const s = await prisma.session.findUnique({ where: { tokenHash: sha(token) }, include: { user: { include: { role: true } } } });
  if (!s || s.id !== claims.sid || s.userId !== claims.sub) return null;
  if (s.expiresAt < new Date()) {
    await prisma.session.delete({ where: { id: s.id } }).catch(() => {});
    return null;
  }
  if (!s.user.active) return null; // a deactivated user is signed out on their next request
  return s.user;
}

export async function destroySession(req: Request, res: Response) {
  const token = readCookie(req, COOKIE);
  if (token) await prisma.session.deleteMany({ where: { tokenHash: sha(token) } });
  res.clearCookie(COOKIE, { path: "/" });
}

// CSRF defence on top of SameSite=Lax: state-changing requests must come from our own origin.
const allowedOrigin = () => new URL(process.env.STOREFRONT_URL ?? "http://localhost:5173").origin;

// API keys: `Authorization: Bearer uvk_...`. They carry no cookie, so CSRF doesn't apply; the role limits what they can do.
async function keyUser(req: Request) {
  const m = /^Bearer (uvk_[A-Za-z0-9_-]{20,})$/.exec(req.header("authorization") ?? "");
  if (!m) return null;
  const k = await prisma.apiKey.findUnique({ where: { keyHash: sha(m[1]) } });
  if (!k || k.revokedAt) return null;
  const role = await prisma.role.findUnique({ where: { id: k.roleId } });
  if (!role || permsOf(role).owner) return null;
  if (!k.lastUsedAt || Date.now() - k.lastUsedAt.getTime() > 60_000) await prisma.apiKey.update({ where: { id: k.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  return { id: `key:${k.id}`, email: `api-key:${k.name}`, name: k.name, roleId: role.id, role, active: true, apiKey: true } as unknown as NonNullable<Awaited<ReturnType<typeof currentUser>>>;
}

export const requireAdmin: RequestHandler = async (req, res, next) => {
  const viaKey = usesApiKey(req); // JWT requests keep the CSRF checks below even when a proxy attached the header
  if (!viaKey && !["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const origin = req.header("origin");
    if (origin && origin !== allowedOrigin()) return void res.status(403).json({ error: "bad origin" });
    if (req.header("sec-fetch-site") === "cross-site") return void res.status(403).json({ error: "bad origin" });
  }
  const user = viaKey ? await keyUser(req) : await currentUser(req);
  if (!user) return void res.status(401).json({ error: "unauthorized" });
  (req as Request & { user?: typeof user }).user = user;
  next();
};

// Markets (= currencies) an admin has allowed this staff member to transact in. null = unrestricted (owners, and anyone the admin left on "all").
export function marketScope(u: { allowedMarkets?: string | null; role?: { name: string; isSystem: boolean; permissions: string } | null }): string[] | null {
  if (permsOf(u.role).owner) return null;
  try {
    const a = JSON.parse(u.allowedMarkets ?? "[]");
    return Array.isArray(a) && a.length ? a.map(String) : null;
  } catch { return null; }
}
export const scopeCodes = (req: Request) => marketScope((req as Request & { user: Parameters<typeof marketScope>[0] }).user);
/** The market they work in: their pick if allowed, else their first allowed one. null = all markets. */
export function workingMarket(u: { preferredMarket?: string | null; allowedMarkets?: string | null; role?: Parameters<typeof marketScope>[0]["role"] }): string | null {
  const s = marketScope(u);
  if (!s) return u.preferredMarket ?? null;
  return u.preferredMarket && s.includes(u.preferredMarket) ? u.preferredMarket : s[0];
}
/** 403 unless the market is one this staff member may transact in. */
export async function assertMarketAllowed(req: Request, marketId: string) {
  const s = scopeCodes(req);
  if (!s) return;
  const m = await prisma.market.findUnique({ where: { id: marketId }, select: { code: true } });
  if (!m || !s.includes(m.code)) throw Object.assign(new Error("An admin hasn't given you access to that market."), { status: 403 });
}
/** router.param("id") guard: an order in a market this staff member can't work in doesn't exist for them. */
export const orderScopeParam = async (req: Request, res: Response, next: () => void, id: string) => {
  const s = scopeCodes(req);
  if (s) {
    const o = await prisma.order.findUnique({ where: { id }, select: { market: { select: { code: true } } } });
    if (o && !s.includes(o.market.code)) return void res.status(404).json({ error: "not found" });
  }
  next();
};
export type AdminReq = Request & { user: NonNullable<Awaited<ReturnType<typeof currentUser>>> };
export const actor = (req: Request) => (req as AdminReq).user;
export const actorPerms = (req: Request): Perms => permsOf(actor(req).role);

/**
 * Route guard. GET/HEAD need one of `read`, everything else one of `write` (`manage` includes `view`).
 * `readOpen`: any signed-in staff may read (markets are needed on almost every screen).
 */
export const guard = (o: { read?: string[]; write: string[]; readOpen?: boolean }): RequestHandler => (req, res, next) => {
  const p = actorPerms(req);
  const reading = req.method === "GET" || req.method === "HEAD";
  if (reading && o.readOpen) return next();
  if ((reading ? (o.read ?? o.write) : o.write).some((x) => has(p, x))) return next();
  res.status(403).json({ error: "You don't have permission to do that. Ask an owner to change your role." });
};
