import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { Request, RequestHandler, Response } from "express";
import { prisma } from "./db.js";
import { has, permsOf, type Perms } from "./permissions.js";

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
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_MS);
  await prisma.session.create({ data: { tokenHash: sha(token), userId, expiresAt } });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: secure(), expires: expiresAt, path: "/" });
}

export function readCookie(req: Request, name: string): string | undefined {
  const raw = req.header("cookie");
  if (!raw) return;
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
}

export async function currentUser(req: Request) {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  const s = await prisma.session.findUnique({ where: { tokenHash: sha(token) }, include: { user: { include: { role: true } } } });
  if (!s) return null;
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

export const requireAdmin: RequestHandler = async (req, res, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const origin = req.header("origin");
    if (origin && origin !== allowedOrigin()) return void res.status(403).json({ error: "bad origin" });
  }
  const user = await currentUser(req);
  if (!user) return void res.status(401).json({ error: "unauthorized" });
  (req as Request & { user?: typeof user }).user = user;
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
