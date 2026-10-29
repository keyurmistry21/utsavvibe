import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { actor, actorPerms, hashPassword } from "../auth.js";
import { audit } from "../audit.js";
import { has, OWNER, PERMISSION_GROUPS, permsOf, validPermissions } from "../permissions.js";

// Staff users and roles. Mounted behind `guard(users.manage)`.
export const usersRouter = Router();
const bad = (msg: string, status = 400) => Object.assign(new Error(msg), { status });

const publicUser = (u: { id: string; email: string; name: string; active: boolean; lastLoginAt: Date | null; createdAt: Date; role: { id: string; name: string } | null }) => ({
  id: u.id, email: u.email, name: u.name, active: u.active, lastLoginAt: u.lastLoginAt, createdAt: u.createdAt, role: u.role ? { id: u.role.id, name: u.role.name } : null,
});
const include = { role: { select: { id: true, name: true } } } as const;
const password = z.string().min(10, "Use at least 10 characters").max(200);

// You can only hand out access you have yourself, so nobody can promote themselves or a friend past their own level.
async function assertCanGrant(req: Parameters<typeof actorPerms>[0], roleId: string) {
  const role = await prisma.role.findUnique({ where: { id: roleId } });
  if (!role) throw bad("That role no longer exists");
  const mine = actorPerms(req);
  const target = permsOf(role);
  if (target.owner && !mine.owner) throw bad("Only an owner can give someone the Owner role", 403);
  const missing = [...target.set].filter((p) => !has(mine, p));
  if (missing.length) throw bad(`You can't grant access you don't have yourself (${missing[0]})`, 403);
  return role;
}

const otherActiveOwners = (exceptId: string) => prisma.adminUser.count({ where: { id: { not: exceptId }, active: true, role: { name: OWNER, isSystem: true } } });

usersRouter.get("/meta", (_req, res) => res.json({ groups: PERMISSION_GROUPS.map((g) => ({ group: g.group, items: g.items.map(([key, label]) => ({ key, label })) })) }));

// Security log: sign-ins, staff, role and key changes.
usersRouter.get("/audit-log", async (_req, res) => {
  res.json(await prisma.auditLog.findMany({ orderBy: { at: "desc" }, take: 200 }));
});

usersRouter.get("/", async (_req, res) => {
  const users = await prisma.adminUser.findMany({ include, orderBy: { createdAt: "asc" } });
  res.json(users.map(publicUser));
});

usersRouter.post("/", async (req, res) => {
  const d = z.object({ email: z.string().trim().toLowerCase().email(), name: z.string().trim().min(1, "Enter a name").max(100), roleId: z.string(), password }).parse(req.body);
  await assertCanGrant(req, d.roleId);
  if (await prisma.adminUser.findUnique({ where: { email: d.email } })) throw bad("A staff member with this email already exists", 409);
  const u = await prisma.adminUser.create({ data: { email: d.email, name: d.name, roleId: d.roleId, passwordHash: await hashPassword(d.password) }, include });
  await audit(req, "staff_created", `${u.email} as ${u.role?.name}`);
  res.status(201).json(publicUser(u));
});

usersRouter.put("/:id", async (req, res) => {
  const d = z.object({ name: z.string().trim().min(1).max(100), roleId: z.string(), active: z.boolean() }).parse(req.body);
  const cur = await prisma.adminUser.findUnique({ where: { id: req.params.id }, include: { role: true } });
  if (!cur) throw bad("User not found", 404);
  const me = actor(req);
  if (cur.id === me.id && (d.roleId !== cur.roleId || !d.active)) throw bad("You can't change your own role or deactivate yourself. Ask another owner.", 400);
  const wasOwner = permsOf(cur.role).owner;
  if (cur.roleId !== d.roleId || !d.active) {
    // changing an owner's access is itself owner-level
    if (wasOwner && !actorPerms(req).owner) throw bad("Only an owner can change an owner", 403);
    if (cur.roleId !== d.roleId) await assertCanGrant(req, d.roleId);
    const stillOwner = d.active && (await prisma.role.findUnique({ where: { id: d.roleId } }))?.name === OWNER;
    if (wasOwner && !stillOwner && !(await otherActiveOwners(cur.id))) throw bad("There must always be at least one active owner");
  }
  const u = await prisma.adminUser.update({ where: { id: cur.id }, data: { name: d.name, roleId: d.roleId, active: d.active }, include });
  if (!d.active) await prisma.session.deleteMany({ where: { userId: cur.id } });
  if (cur.roleId !== d.roleId || cur.active !== d.active) await audit(req, "staff_changed", `${cur.email}: role ${cur.role?.name} -> ${u.role?.name}, active ${d.active}`);
  res.json(publicUser(u));
});

usersRouter.post("/:id/reset-password", async (req, res) => {
  const d = z.object({ password }).parse(req.body);
  const cur = await prisma.adminUser.findUnique({ where: { id: req.params.id }, include: { role: true } });
  if (!cur) throw bad("User not found", 404);
  if (permsOf(cur.role).owner && !actorPerms(req).owner) throw bad("Only an owner can reset an owner's password", 403);
  await prisma.adminUser.update({ where: { id: cur.id }, data: { passwordHash: await hashPassword(d.password) } });
  await prisma.session.deleteMany({ where: { userId: cur.id } }); // signs them out everywhere
  await audit(req, "staff_password_reset", cur.email);
  res.json({ ok: true });
});

// Lost phone: an owner switches off someone's two-factor sign-in so they can sign in and set it up again.
usersRouter.post("/:id/reset-2fa", async (req, res) => {
  const cur = await prisma.adminUser.findUnique({ where: { id: req.params.id }, include: { role: true } });
  if (!cur) throw bad("User not found", 404);
  if (permsOf(cur.role).owner && !actorPerms(req).owner) throw bad("Only an owner can reset an owner's two-factor sign-in", 403);
  await prisma.adminUser.update({ where: { id: cur.id }, data: { totpEnabled: false, totpSecret: null } });
  await prisma.session.deleteMany({ where: { userId: cur.id } });
  await audit(req, "staff_2fa_reset", cur.email);
  res.json({ ok: true });
});

usersRouter.delete("/:id", async (req, res) => {
  const cur = await prisma.adminUser.findUnique({ where: { id: req.params.id }, include: { role: true } });
  if (!cur) return void res.json({ ok: true });
  if (cur.id === actor(req).id) throw bad("You can't delete yourself");
  if (permsOf(cur.role).owner) {
    if (!actorPerms(req).owner) throw bad("Only an owner can delete an owner", 403);
    if (!(await otherActiveOwners(cur.id))) throw bad("There must always be at least one active owner");
  }
  await prisma.adminUser.delete({ where: { id: cur.id } });
  await audit(req, "staff_deleted", cur.email);
  res.json({ ok: true });
});

// ---- roles ----
const roleInput = z.object({
  name: z.string().trim().min(1, "Enter a role name").max(50),
  description: z.string().trim().max(300).default(""),
  permissions: z.array(z.string()).max(50),
});
const roleJson = (r: { id: string; name: string; description: string; permissions: string; isSystem: boolean; _count: { users: number } }) => ({
  id: r.id, name: r.name, description: r.description, isSystem: r.isSystem, users: r._count.users, permissions: [...permsOf(r).set],
});

export const rolesRouter = Router();
rolesRouter.get("/", async (_req, res) => {
  const roles = await prisma.role.findMany({ include: { _count: { select: { users: true } } }, orderBy: { createdAt: "asc" } });
  res.json(roles.map(roleJson));
});

rolesRouter.post("/", async (req, res) => {
  const d = roleInput.parse(req.body);
  if (!validPermissions(d.permissions)) throw bad("Unknown permission");
  const mine = actorPerms(req);
  const missing = d.permissions.find((p) => !has(mine, p));
  if (missing) throw bad(`You can't grant access you don't have yourself (${missing})`, 403);
  if (await prisma.role.findUnique({ where: { name: d.name } })) throw bad("A role with this name already exists", 409);
  const r = await prisma.role.create({ data: { ...d, permissions: JSON.stringify([...new Set(d.permissions)]) }, include: { _count: { select: { users: true } } } });
  await audit(req, "role_created", `${r.name}: ${d.permissions.length} permissions`);
  res.status(201).json(roleJson(r));
});

rolesRouter.put("/:id", async (req, res) => {
  const d = roleInput.parse(req.body);
  const cur = await prisma.role.findUnique({ where: { id: req.params.id } });
  if (!cur) throw bad("Role not found", 404);
  if (cur.isSystem) throw bad("The Owner role can't be changed");
  if (!validPermissions(d.permissions)) throw bad("Unknown permission");
  const mine = actorPerms(req);
  const missing = d.permissions.find((p) => !has(mine, p));
  if (missing) throw bad(`You can't grant access you don't have yourself (${missing})`, 403);
  const clash = await prisma.role.findUnique({ where: { name: d.name } });
  if (clash && clash.id !== cur.id) throw bad("A role with this name already exists", 409);
  // a role you hold yourself can't be edited by you (stops quietly widening your own access)
  if (actor(req).roleId === cur.id && !mine.owner) throw bad("You can't edit the role you hold. Ask an owner.", 403);
  const r = await prisma.role.update({ where: { id: cur.id }, data: { ...d, permissions: JSON.stringify([...new Set(d.permissions)]) }, include: { _count: { select: { users: true } } } });
  await audit(req, "role_changed", `${r.name}: ${d.permissions.length} permissions`);
  res.json(roleJson(r));
});

rolesRouter.delete("/:id", async (req, res) => {
  const cur = await prisma.role.findUnique({ where: { id: req.params.id }, include: { _count: { select: { users: true } } } });
  if (!cur) return void res.json({ ok: true });
  if (cur.isSystem) throw bad("The Owner role can't be deleted");
  if (cur._count.users) throw bad(`${cur._count.users} staff member${cur._count.users === 1 ? " has" : "s have"} this role. Move them to another role first.`);
  await prisma.role.delete({ where: { id: cur.id } });
  res.json({ ok: true });
});
