import { Router } from "express";
import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import { prisma, parseJson } from "../db.js";
import { actor, actorPerms, usesApiKey } from "../auth.js";
import { audit } from "../audit.js";
import { has, permsOf } from "../permissions.js";
import { assertPublicUrl } from "../ssrf.js";
import { EVENTS, sendTest } from "../webhooks.js";
import { feedLinks } from "./feeds.js";
import { getSetting, putSetting } from "../appSettings.js";
import { runAbandonedJob, sendRecovery } from "../abandoned.js";

// Feeds, abandoned-checkout emails, API keys and webhooks. Mounted behind `guard(integrations.manage)`.
export const integrationsRouter = Router();
const bad = (msg: string, status = 400) => Object.assign(new Error(msg), { status });
const noKey = (req: Parameters<typeof actor>[0]) => {
  if (usesApiKey(req)) throw bad("Not available with an API key", 403);
};

// ---- API keys ----
integrationsRouter.get("/api-keys", async (_req, res) => {
  const [keys, roles] = await Promise.all([prisma.apiKey.findMany({ orderBy: { createdAt: "desc" } }), prisma.role.findMany()]);
  const name = new Map(roles.map((r) => [r.id, r.name]));
  res.json(keys.map((k) => ({ id: k.id, name: k.name, prefix: k.prefix, role: name.get(k.roleId) ?? "(deleted role)", createdBy: k.createdBy, lastUsedAt: k.lastUsedAt, revokedAt: k.revokedAt, createdAt: k.createdAt })));
});

integrationsRouter.post("/api-keys", async (req, res) => {
  noKey(req);
  const d = z.object({ name: z.string().trim().min(1, "Give the key a name").max(60), roleId: z.string() }).parse(req.body);
  const role = await prisma.role.findUnique({ where: { id: d.roleId } });
  if (!role) throw bad("That role no longer exists");
  const p = permsOf(role);
  // keys get least privilege: never Owner, and never the power to manage staff or mint more keys
  if (p.owner || has(p, "users.manage") || has(p, "integrations.manage")) throw bad("Choose a role without staff or integration management. Create a dedicated role for the key.");
  const mine = actorPerms(req);
  const missing = [...p.set].find((x) => !has(mine, x));
  if (missing) throw bad(`You can't grant access you don't have yourself (${missing})`, 403);
  const secret = "uvk_" + randomBytes(32).toString("base64url");
  const k = await prisma.apiKey.create({ data: { name: d.name, prefix: secret.slice(0, 10), keyHash: createHash("sha256").update(secret).digest("hex"), roleId: role.id, createdBy: actor(req).email } });
  await audit(req, "api_key_created", `${d.name} (${role.name})`);
  res.status(201).json({ id: k.id, name: k.name, prefix: k.prefix, secret }); // the only time the secret is shown
});

integrationsRouter.delete("/api-keys/:id", async (req, res) => {
  noKey(req);
  const k = await prisma.apiKey.findUnique({ where: { id: req.params.id } });
  if (k && !k.revokedAt) {
    await prisma.apiKey.update({ where: { id: k.id }, data: { revokedAt: new Date() } });
    await audit(req, "api_key_revoked", k.name);
  }
  res.json({ ok: true });
});

// ---- webhooks ----
const hookInput = z.object({ url: z.string().url().max(500), events: z.array(z.enum(EVENTS)).min(1, "Pick at least one event"), active: z.boolean().default(true) });
const hookJson = (h: { id: string; url: string; events: string; active: boolean; createdAt: Date; deliveries?: { event: string; status: number; error: string; at: Date }[] }) => ({
  id: h.id, url: h.url, events: parseJson<string[]>(h.events, []), active: h.active, createdAt: h.createdAt, recent: h.deliveries ?? [],
});

integrationsRouter.get("/webhooks", async (_req, res) => {
  const hooks = await prisma.webhookEndpoint.findMany({ orderBy: { createdAt: "asc" }, include: { deliveries: { orderBy: { at: "desc" }, take: 5 } } });
  res.json({ events: EVENTS, hooks: hooks.map(hookJson) });
});

integrationsRouter.post("/webhooks", async (req, res) => {
  noKey(req);
  const d = hookInput.parse(req.body);
  try { await assertPublicUrl(d.url); } catch (e) { throw bad((e as Error).message); }
  const secret = "uvwh_" + randomBytes(24).toString("base64url");
  const h = await prisma.webhookEndpoint.create({ data: { url: d.url, events: JSON.stringify(d.events), active: d.active, secret } });
  await audit(req, "webhook_created", d.url);
  res.status(201).json({ ...hookJson(h), secret }); // shown once; receivers verify `x-utsavvibe-signature`
});

integrationsRouter.put("/webhooks/:id", async (req, res) => {
  noKey(req);
  const d = hookInput.parse(req.body);
  try { await assertPublicUrl(d.url); } catch (e) { throw bad((e as Error).message); }
  const h = await prisma.webhookEndpoint.update({ where: { id: req.params.id }, data: { url: d.url, events: JSON.stringify(d.events), active: d.active } }).catch(() => null);
  if (!h) throw bad("Webhook not found", 404);
  await audit(req, "webhook_changed", d.url);
  res.json(hookJson(h));
});

integrationsRouter.delete("/webhooks/:id", async (req, res) => {
  noKey(req);
  const h = await prisma.webhookEndpoint.findUnique({ where: { id: req.params.id } });
  if (h) {
    await prisma.webhookEndpoint.delete({ where: { id: h.id } });
    await audit(req, "webhook_deleted", h.url);
  }
  res.json({ ok: true });
});

integrationsRouter.post("/webhooks/:id/test", async (req, res) => {
  if (!(await prisma.webhookEndpoint.findUnique({ where: { id: req.params.id } }))) throw bad("Webhook not found", 404);
  await sendTest(req.params.id);
  res.json({ deliveries: await prisma.webhookDelivery.findMany({ where: { endpointId: req.params.id }, orderBy: { at: "desc" }, take: 10 }) });
});

integrationsRouter.get("/webhooks/:id/deliveries", async (req, res) => {
  res.json(await prisma.webhookDelivery.findMany({ where: { endpointId: req.params.id }, orderBy: { at: "desc" }, take: 30 }));
});

// ---- marketing: feeds + abandoned checkouts ----
integrationsRouter.get("/marketing", async (_req, res) => {
  const [feeds, abandoned] = await Promise.all([feedLinks(), getSetting("marketing")]);
  const since = new Date(Date.now() - 30 * 24 * 3600_000);
  const [sent, recovered] = await Promise.all([
    prisma.order.count({ where: { recoveryEmailAt: { gt: since } } }),
    prisma.order.count({ where: { recoveryEmailAt: { gt: since }, paymentStatus: "paid" } }),
  ]);
  const customersAskingForReminders = await prisma.customer.count({ where: { acceptsEmail: true } });
  res.json({ feeds, abandoned, stats: { sent30d: sent, recovered30d: recovered, optedIn: customersAskingForReminders }, mailConfigured: !!process.env.SMTP_HOST });
});

integrationsRouter.put("/marketing", async (req, res) => {
  const d = z.object({ abandonedEnabled: z.boolean(), delayHours: z.number().int().min(1).max(72) }).parse(req.body);
  await putSetting("marketing", d);
  await audit(req, "marketing_settings", `abandoned emails ${d.abandonedEnabled ? "on" : "off"}`);
  res.json(d);
});

// Checkouts that were started and not paid, newest first.
integrationsRouter.get("/abandoned", async (_req, res) => {
  const rows = await prisma.order.findMany({
    where: { stripeSessionId: { not: null }, status: { not: "draft" }, createdAt: { gt: new Date(Date.now() - 14 * 24 * 3600_000) }, OR: [{ paymentStatus: "failed" }, { paymentStatus: "pending", status: "open" }] },
    include: { customer: true }, orderBy: { createdAt: "desc" }, take: 100,
  });
  res.json(rows.map((o) => ({ id: o.id, number: o.number, createdAt: o.createdAt, currency: o.currency, total: o.total, email: o.customer?.email ?? null, name: o.customer?.name ?? "", consent: !!o.customer?.acceptsEmail, reminderSentAt: o.recoveryEmailAt })));
});

integrationsRouter.post("/abandoned/:id/send", async (req, res) => {
  // staff pressing the button is an explicit action on a customer who asked for reminders; the consent flag still applies
  const r = await sendRecovery(req.params.id);
  const msg: Record<string, string> = { no_email: "This checkout has no email address", paid: "This order was paid already", no_consent: "This customer didn't ask for cart reminders", already_sent: "A reminder was already sent", bought_since: "They bought something else since" };
  if (r.status !== "sent") throw bad(msg[r.status] ?? ("error" in r && r.error) ?? "Could not send the email", r.status === "failed" ? 502 : 409);
  res.json({ sent: true });
});

integrationsRouter.post("/abandoned/run", async (_req, res) => {
  await runAbandonedJob();
  res.json({ ok: true });
});
