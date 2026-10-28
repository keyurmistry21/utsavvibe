import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { permsOf } from "../permissions.js";
import { createSession, currentUser, destroySession, hashPassword, requireAdmin, verifyPassword } from "../auth.js";

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

type U = { id: string; email: string; name: string; role?: { id: string; name: string; isSystem: boolean; permissions: string } | null };
const publicUser = (u: U) => ({ id: u.id, email: u.email, name: u.name, role: u.role?.name ?? null, owner: permsOf(u.role).owner, permissions: [...permsOf(u.role).set] });

authRouter.post("/login", async (req, res) => {
  const { email, password } = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
  const key = `${email.toLowerCase()}|${req.ip}`;
  if (limited(key)) return void res.status(429).json({ error: "Too many attempts. Try again in 15 minutes." });

  const user = await prisma.adminUser.findUnique({ where: { email: email.toLowerCase() }, include: { role: true } });
  const ok = await verifyPassword(password, user?.passwordHash ?? (await dummy));
  if (user && ok && !user.active) return void res.status(403).json({ error: "This account has been deactivated. Ask an owner to turn it back on." });
  if (!user || !ok) {
    fail(key);
    return void res.status(401).json({ error: "Invalid email or password" });
  }
  fails.delete(key);
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
  // sign out every other device
  await prisma.session.deleteMany({ where: { userId: user.id } });
  await createSession(res, user.id);
  res.json({ ok: true });
});
