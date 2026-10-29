import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { permsOf } from "../permissions.js";
import { createSession, currentUser, destroySession, hashPassword, requireAdmin, usesApiKey, verifyPassword } from "../auth.js";
import { audit } from "../audit.js";
import { decrypt, encrypt } from "../secrets.js";
import { newSecret, otpauthUri, verifyTotp } from "../totp.js";
import { storeName } from "../mail.js";

export const authRouter = Router();

// Throttle brute force: 5 failures per email+ip per 15 min. In-memory; use Redis if you run several instances.
const fails = new Map<string, { n: number; until: number }>();
const WINDOW = 15 * 60 * 1000;
const limited = (k: string) => {
  const f = fails.get(k);
  if (f && f.until < Date.now()) fails.delete(k);
  return (fails.get(k)?.n ?? 0) >= 5;
};
const fail = (k: string) => {
  const f = fails.get(k);
  fails.set(k, { n: (f?.n ?? 0) + 1, until: f?.until ?? Date.now() + WINDOW });
};

// Hash for a dummy password so unknown emails cost the same time as wrong passwords.
const dummy = hashPassword("not-a-real-password");

type U = { id: string; email: string; name: string; totpEnabled?: boolean; role?: { id: string; name: string; isSystem: boolean; permissions: string } | null };
const publicUser = (u: U) => ({ id: u.id, email: u.email, name: u.name, role: u.role?.name ?? null, owner: permsOf(u.role).owner, permissions: [...permsOf(u.role).set], twoFactor: !!u.totpEnabled });

authRouter.post("/login", async (req, res) => {
  const { email, password, code } = z.object({ email: z.string().email(), password: z.string().min(1).max(200), code: z.string().max(10).optional() }).parse(req.body);
  const key = `${email.toLowerCase()}|${req.ip}`;
  if (limited(key)) return void res.status(429).json({ error: "Too many attempts. Try again in 15 minutes." });

  const user = await prisma.adminUser.findUnique({ where: { email: email.toLowerCase() }, include: { role: true } });
  const ok = await verifyPassword(password, user?.passwordHash ?? (await dummy));
  if (user && ok && !user.active) return void res.status(403).json({ error: "This account has been deactivated. Ask an owner to turn it back on." });
  if (!user || !ok) {
    fail(key);
    await audit(req, "login_failed", email.toLowerCase(), { id: "", email: email.toLowerCase() });
    return void res.status(401).json({ error: "Invalid email or password" });
  }
  if (user.totpEnabled && user.totpSecret) {
    if (!code) return void res.status(401).json({ error: "Enter the 6-digit code from your authenticator app" });
    if (!verifyTotp(decrypt(user.totpSecret), code)) {
      fail(key);
      await audit(req, "login_2fa_failed", user.email, user);
      return void res.status(401).json({ error: "That code is not right. Try the newest code from your app." });
    }
  }
  fails.delete(key);
  await audit(req, "login", "", user);
  await createSession(res, user.id);
  await prisma.adminUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  res.json(publicUser(user));
});

authRouter.post("/logout", async (req, res) => {
  await destroySession(req, res);
  res.json({ ok: true });
});

authRouter.get("/me", async (req, res) => {
  const user = await currentUser(req);
  if (!user) return void res.status(401).json({ error: "unauthorized" });
  res.json(publicUser(user));
});

// Staff can rename themselves (role and email are managed by owners).
authRouter.put("/profile", requireAdmin, async (req, res) => {
  const { name } = z.object({ name: z.string().trim().min(1, "Enter your name").max(100) }).parse(req.body);
  const user = (await currentUser(req))!;
  const u = await prisma.adminUser.update({ where: { id: user.id }, data: { name }, include: { role: true } });
  res.json(publicUser(u));
});

authRouter.post("/password", requireAdmin, async (req, res) => {
  const { current, next } = z.object({ current: z.string(), next: z.string().min(10, "at least 10 characters") }).parse(req.body);
  const user = (await currentUser(req))!;
  if (!(await verifyPassword(current, user.passwordHash))) return void res.status(400).json({ error: "Current password is wrong" });
  await prisma.adminUser.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(next) } });
  await audit(req, "password_changed", "", user);
  // sign out every other device
  await prisma.session.deleteMany({ where: { userId: user.id } });
  await createSession(res, user.id);
  res.json({ ok: true });
});

// Two-factor sign-in (authenticator app). Cookie sessions only: an API key can't change who can sign in.
const noKey: import("express").RequestHandler = (req, res, next) => (usesApiKey(req) ? void res.status(403).json({ error: "Not available with an API key" }) : next());

authRouter.post("/2fa/start", requireAdmin, noKey, async (req, res) => {
  const user = (await currentUser(req))!;
  if (user.totpEnabled) return void res.status(409).json({ error: "Two-factor sign-in is already on" });
  const secret = newSecret();
  await prisma.adminUser.update({ where: { id: user.id }, data: { totpSecret: encrypt(secret) } });
  res.json({ secret, uri: otpauthUri(secret, user.email, storeName()) });
});

authRouter.post("/2fa/enable", requireAdmin, noKey, async (req, res) => {
  const { code } = z.object({ code: z.string().max(10) }).parse(req.body);
  const user = (await currentUser(req))!;
  if (!user.totpSecret || user.totpEnabled) return void res.status(409).json({ error: "Start setup first" });
  if (!verifyTotp(decrypt(user.totpSecret), code)) return void res.status(400).json({ error: "That code is not right. Check the time on your phone and try again." });
  await prisma.adminUser.update({ where: { id: user.id }, data: { totpEnabled: true } });
  await audit(req, "2fa_enabled", "", user);
  res.json({ ok: true });
});

authRouter.post("/2fa/disable", requireAdmin, noKey, async (req, res) => {
  const { password, code } = z.object({ password: z.string().max(200), code: z.string().max(10) }).parse(req.body);
  const user = (await currentUser(req))!;
  if (!user.totpEnabled || !user.totpSecret) return void res.status(409).json({ error: "Two-factor sign-in is already off" });
  if (!(await verifyPassword(password, user.passwordHash))) return void res.status(400).json({ error: "Password is wrong" });
  if (!verifyTotp(decrypt(user.totpSecret), code)) return void res.status(400).json({ error: "That code is not right" });
  await prisma.adminUser.update({ where: { id: user.id }, data: { totpEnabled: false, totpSecret: null } });
  await audit(req, "2fa_disabled", "", user);
  res.json({ ok: true });
});
