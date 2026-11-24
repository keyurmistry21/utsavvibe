import { Router } from "express";
import { z } from "zod";
import { prisma, parseJson } from "../db.js";
import { audit } from "../audit.js";
import { actor } from "../auth.js";
import { esc } from "../emails.js";
import { mailConfigured, sendMail, storeName } from "../mail.js";
import { smsConfigured, smsNumber, sendSms } from "../sms.js";
import { unsubscribeUrl } from "../abandoned.js";

// Email and SMS campaigns, only to customers who opted in (acceptsEmail / acceptsSms). Mounted behind guard(integrations.manage).
export const campaignsRouter = Router();
const bad = (msg: string, status = 400) => Object.assign(new Error(msg), { status });

const input = z.object({
  name: z.string().trim().min(1, "Name the campaign").max(120),
  channel: z.enum(["email", "sms"]),
  subject: z.string().trim().max(200).default(""),
  body: z.string().trim().min(1, "Write the message").max(5000),
  audience: z.string().trim().max(60).regex(/^(all|buyers|tag:[^\s]{1,40}|market:[A-Za-z]{2,8})$/, "Choose an audience").default("all"),
}).superRefine((d, ctx) => {
  if (d.channel === "email" && !d.subject) ctx.addIssue({ code: "custom", path: ["subject"], message: "Add a subject line" });
  if (d.channel === "sms" && d.body.length > 320) ctx.addIssue({ code: "custom", path: ["body"], message: "Keep texts under 320 characters" });
});

type Cust = { id: string; email: string | null; name: string; phone: string | null; tags: string };
async function recipients(channel: string, audience: string): Promise<Cust[]> {
  const base = { ...(channel === "email" ? { acceptsEmail: true, email: { not: null } } : { acceptsSms: true, phone: { not: null } }) };
  let where: Record<string, unknown> = base;
  if (audience === "buyers") where = { ...base, orders: { some: { paymentStatus: "paid" } } };
  if (audience.startsWith("market:")) where = { ...base, orders: { some: { paymentStatus: "paid", market: { code: audience.slice(7).toUpperCase() } } } };
  const rows = (await prisma.customer.findMany({ where, select: { id: true, email: true, name: true, phone: true, tags: true }, take: 20_000 })) as Cust[];
  if (audience.startsWith("tag:")) return rows.filter((c) => parseJson<string[]>(c.tags, []).includes(audience.slice(4)));
  return channel === "sms" ? rows.filter((c) => smsNumber(c.phone)) : rows;
}

campaignsRouter.get("/", async (_req, res) => res.json({ emailReady: mailConfigured(), smsReady: smsConfigured(), campaigns: await prisma.campaign.findMany({ orderBy: { createdAt: "desc" }, take: 100 }) }));

campaignsRouter.get("/audience", async (req, res) => {
  const channel = req.query.channel === "sms" ? "sms" : "email";
  res.json({ count: (await recipients(channel, String(req.query.audience ?? "all"))).length });
});

campaignsRouter.post("/", async (req, res) => {
  const d = input.parse(req.body);
  res.status(201).json(await prisma.campaign.create({ data: { ...d, createdBy: actor(req).email } }));
});

campaignsRouter.put("/:id", async (req, res) => {
  const d = input.parse(req.body);
  const c = await prisma.campaign.findUnique({ where: { id: req.params.id } });
  if (!c) throw bad("not found", 404);
  if (c.status !== "draft") throw bad("A campaign that was sent can't be edited", 409);
  res.json(await prisma.campaign.update({ where: { id: c.id }, data: d }));
});

campaignsRouter.delete("/:id", async (req, res) => {
  const c = await prisma.campaign.findUnique({ where: { id: req.params.id } });
  if (!c) throw bad("not found", 404);
  if (c.status === "sending") throw bad("This campaign is sending right now", 409);
  await prisma.campaign.delete({ where: { id: c.id } });
  res.json({ ok: true });
});

const emailHtml = (body: string, unsub: string) =>
  `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#2a1d14;line-height:1.6">${body.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("")}<p style="margin-top:28px;color:#7a6a5e;font-size:12px">You're getting this because you agreed to receive offers from ${esc(storeName())}. <a href="${esc(unsub)}" style="color:#7a6a5e">Unsubscribe</a></p></div>`;

async function deliver(c: { channel: string; subject: string; body: string; id: string }, to: Cust) {
  if (c.channel === "email") {
    const unsub = unsubscribeUrl(to.id);
    const r = await sendMail({ to: to.email!, kind: "campaign", subject: c.subject, html: emailHtml(c.body, unsub), text: `${c.body}\n\nUnsubscribe: ${unsub}\n${storeName()}`, headers: { "List-Unsubscribe": `<${unsub}>` } });
    return r.status === "sent";
  }
  const r = await sendSms(smsNumber(to.phone)!, `${c.body}\n${storeName()}: reply STOP to opt out`);
  return r.ok;
}

// A test goes to the signed-in person only (their own email, or ?phone= for SMS).
campaignsRouter.post("/:id/test", async (req, res) => {
  const c = await prisma.campaign.findUnique({ where: { id: req.params.id } });
  if (!c) throw bad("not found", 404);
  const me = actor(req);
  if (c.channel === "email") {
    const ok = await deliver(c, { id: "test", email: me.email, name: me.name, phone: null, tags: "[]" });
    return void res.json({ sent: ok, note: ok ? `Sent to ${me.email}` : mailConfigured() ? "The email could not be sent" : "Email is not set up (SMTP_HOST in backend/.env)" });
  }
  const phone = smsNumber(z.object({ phone: z.string() }).parse(req.body).phone);
  if (!phone) throw bad("Enter your number with the country code, like +14165550123");
  const r = await sendSms(phone, `${c.body}\n${storeName()}: reply STOP to opt out`);
  res.json({ sent: r.ok, note: r.ok ? "Sent" : r.error });
});

campaignsRouter.post("/:id/send", async (req, res) => {
  const c = await prisma.campaign.findUnique({ where: { id: req.params.id } });
  if (!c) throw bad("not found", 404);
  if (c.channel === "email" && !mailConfigured()) throw bad("Email isn't set up yet (SMTP_HOST in backend/.env)");
  if (c.channel === "sms" && !smsConfigured()) throw bad("SMS isn't set up yet (TWILIO_* in backend/.env)");
  const flip = await prisma.campaign.updateMany({ where: { id: c.id, status: "draft" }, data: { status: "sending", sentCount: 0, failedCount: 0 } });
  if (!flip.count) throw bad("This campaign was already sent", 409);
  const list = await recipients(c.channel, c.audience);
  await audit(req, "campaign_sent", `${c.name}: ${list.length} ${c.channel} recipients`);
  res.json({ queued: list.length });
  // sent in the background, gently, so one slow provider call doesn't hold the request or hammer the provider
  void (async () => {
    let sent = 0, failed = 0;
    for (const to of list) {
      (await deliver(c, to).catch(() => false)) ? sent++ : failed++;
      if ((sent + failed) % 10 === 0) await prisma.campaign.update({ where: { id: c.id }, data: { sentCount: sent, failedCount: failed } }).catch(() => {});
      await new Promise((r) => setTimeout(r, 120));
    }
    await prisma.campaign.update({ where: { id: c.id }, data: { status: "sent", sentAt: new Date(), sentCount: sent, failedCount: failed } }).catch(() => {});
  })();
});
