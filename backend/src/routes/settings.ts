import { Router } from "express";
import { z } from "zod";
import { prisma, parseJson } from "../db.js";
import { currentUser } from "../auth.js";
import { testEmail } from "../emails.js";
import { mailConfigured, sendMail } from "../mail.js";

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

settingsRouter.get("/ship-from", async (_req, res) => {
  const row = await prisma.setting.findUnique({ where: { key: "shipFrom" } });
  res.json(shipFrom.parse(parseJson(row?.value ?? "{}", {})));
});

settingsRouter.put("/ship-from", async (req, res) => {
  const v = shipFrom.parse(req.body);
  await prisma.setting.upsert({ where: { key: "shipFrom" }, create: { key: "shipFrom", value: JSON.stringify(v) }, update: { value: JSON.stringify(v) } });
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
