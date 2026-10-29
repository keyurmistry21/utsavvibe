import { Router } from "express";
import { z } from "zod";
import { prisma, parseJson } from "../db.js";
import { currentUser } from "../auth.js";
import { testEmail } from "../emails.js";
import { shipFromAddress } from "./locations.js";
import { mailConfigured, sendMail } from "../mail.js";
import { getSetting, putSetting } from "../appSettings.js";
import { audit } from "../audit.js";

export const settingsRouter = Router();

const shipFrom = z.object({
  name: z.string().default(""),
  company: z.string().default(""),
  line1: z.string().default(""),
  line2: z.string().default(""),
  city: z.string().default(""),
  region: z.string().default(""),
  postcode: z.string().default(""),
  country: z.string().default(""),
  phone: z.string().default(""),
});

// Sender address on labels = the default location (kept as an endpoint so labels and the General page keep working).
settingsRouter.get("/ship-from", async (_req, res) => {
  res.json(shipFrom.parse(await shipFromAddress()));
});

// Editing it edits the default location (created if there is none yet).
settingsRouter.put("/ship-from", async (req, res) => {
  const v = shipFrom.parse(req.body);
  const loc = await prisma.location.findFirst({ where: { isDefault: true } });
  const data = { name: v.name || v.company || "Main location", company: v.company, line1: v.line1, line2: v.line2, city: v.city, region: v.region, postcode: v.postcode, country: v.country.toUpperCase().slice(0, 2), phone: v.phone };
  if (loc) await prisma.location.update({ where: { id: loc.id }, data });
  else await prisma.location.create({ data: { ...data, isDefault: true } });
  res.json(v);
});

settingsRouter.get("/email-status", (_req, res) => {
  res.json({ configured: mailConfigured(), from: process.env.MAIL_FROM ?? null, host: process.env.SMTP_HOST ?? null, dev: /^(localhost|127\.0\.0\.1)$/.test(process.env.SMTP_HOST ?? "") });
});

// Only to the signed-in admin's own address, so this can't be used to send mail to strangers.
settingsRouter.post("/email-test", async (req, res) => {
  const user = (await currentUser(req))!;
  const r = await sendMail({ to: user.email, kind: "test", ...testEmail() });
  if (r.status !== "sent") return void res.status(502).json({ error: r.error ?? "Could not send" });
  res.json({ sent: true, to: user.email });
});

// Checkout behaviour. Automatic tax asks Stripe Tax for the tax on each order instead of using the fixed market rate.
settingsRouter.get("/checkout", async (_req, res) => {
  res.json({ ...(await getSetting("checkout")), stripeConfigured: !!process.env.STRIPE_SECRET_KEY });
});

settingsRouter.put("/checkout", async (req, res) => {
  const d = z.object({ automaticTax: z.boolean(), highValueMinor: z.number().int().min(0).max(100_000_000) }).parse(req.body);
  await putSetting("checkout", d);
  await audit(req, "checkout_settings", `automatic tax ${d.automaticTax ? "on" : "off"}`);
  res.json(d);
});
