import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { htmlToText, sanitizeDescription } from "../html.js";

export const POLICIES = [
  { key: "refund", title: "Return and refund policy" },
  { key: "privacy", title: "Privacy policy" },
  { key: "terms", title: "Terms of service" },
  { key: "shipping", title: "Shipping policy" },
  { key: "contact", title: "Contact information" },
  { key: "legal", title: "Legal notice" },
  { key: "cancellation", title: "Purchase options cancellation policy" },
] as const;
const titleOf = (key: string) => POLICIES.find((p) => p.key === key)?.title;

// Published = has some text. Mounted behind guard(settings.manage).
export const policiesRouter = Router();

policiesRouter.get("/", async (_req, res) => {
  const rows = await prisma.policy.findMany();
  res.json(POLICIES.map((p) => {
    const r = rows.find((x) => x.key === p.key);
    return { ...p, published: !!r && !!htmlToText(r.content), updatedAt: r?.updatedAt ?? null };
  }));
});

policiesRouter.get("/:key", async (req, res) => {
  const title = titleOf(req.params.key);
  if (!title) return void res.status(404).json({ error: "unknown policy" });
  const r = await prisma.policy.findUnique({ where: { key: req.params.key } });
  res.json({ key: req.params.key, title, content: r?.content ?? "" });
});

policiesRouter.put("/:key", async (req, res) => {
  if (!titleOf(req.params.key)) return void res.status(404).json({ error: "unknown policy" });
  const d = z.object({ content: z.string().max(300_000) }).parse(req.body);
  const content = sanitizeDescription(d.content);
  // a policy that is only empty tags counts as unpublished, so store it empty
  const stored = htmlToText(content) ? content : "";
  await prisma.policy.upsert({ where: { key: req.params.key }, create: { key: req.params.key, content: stored }, update: { content: stored } });
  res.json({ ok: true, published: !!stored });
});

/** Public: only published policies. */
export async function publishedPolicies() {
  const rows = await prisma.policy.findMany();
  return POLICIES.filter((p) => { const r = rows.find((x) => x.key === p.key); return r && htmlToText(r.content); }).map((p) => ({ key: p.key, title: p.title }));
}
export async function publicPolicy(key: string) {
  const title = titleOf(key);
  const r = title ? await prisma.policy.findUnique({ where: { key } }) : null;
  return title && r && htmlToText(r.content) ? { key, title, content: r.content } : null;
}
