import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { actor, scopeCodes, workingMarket } from "../auth.js";
import { audit } from "../audit.js";
import { csvCell } from "../csv.js";

// Expenses: what the business spent. Mounted behind guard(read expenses.view, write expenses.manage).
export const expensesRouter = Router();
const bad = (msg: string, status = 400) => Object.assign(new Error(msg), { status });

const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-07-15").refine((s) => !isNaN(day(s).getTime()), "Not a real date");

const input = z.object({
  date: dateStr,
  amount: z.number().int().min(1, "Enter an amount").max(1_000_000_000),
  currency: z.string().length(3).optional(), // ignored for staff: it comes from their "Working in" market
  vendor: z.string().trim().max(120).default(""),
  note: z.string().trim().max(500).default(""),
});

const currencies = async () => [...new Set((await prisma.market.findMany({ where: { active: true }, select: { currency: true } })).map((m) => m.currency))];

// The currency is not typed in: staff record expenses in the currency of the market they work in ("Working in" in the sidebar).
// API keys have no such market and must send the currency.
async function check(req: Parameters<typeof actor>[0], d: z.infer<typeof input>, existing?: { currency: string }): Promise<string> {
  const u = actor(req) as Parameters<typeof workingMarket>[0] & { id: string };
  let currency: string;
  if (existing) {
    if (d.currency && d.currency.toUpperCase() !== existing.currency) throw bad("An expense's currency can't be changed. Delete it and add a new one.");
    currency = existing.currency;
  } else if (u.id.startsWith("key:")) {
    currency = (d.currency ?? "").toUpperCase();
  } else {
    const wm = workingMarket(u); // for restricted staff this is always one of the markets an admin allowed
    const m = wm ? await prisma.market.findFirst({ where: { code: wm, active: true } }) : null;
    if (!m) throw bad("Choose your market under \"Working in\" (sidebar) first. Expenses are recorded in that market's currency.");
    currency = m.currency;
  }
  if (!existing && !(await currencies()).includes(currency)) throw bad("Pick one of your market currencies");
  if (day(d.date).getTime() > Date.now() + 36 * 3600_000) throw bad("The date can't be in the future");
  if (day(d.date).getFullYear() < 2000) throw bad("That date is too far back");
  return currency;
}

const filters = z.object({
  from: dateStr.optional(), to: dateStr.optional(), currency: z.string().length(3).optional(),
  q: z.string().trim().max(100).optional(),
});
// currencies of the markets this staff member may work in (null = all)
async function scopeCurrencies(req: Parameters<typeof actor>[0]) {
  const s = scopeCodes(req);
  return s ? (await prisma.market.findMany({ where: { code: { in: s } }, select: { currency: true } })).map((m) => m.currency) : null;
}
const where = (f: z.infer<typeof filters>, cur: string[] | null = null) => ({
  ...(f.from || f.to ? { date: { ...(f.from ? { gte: day(f.from) } : {}), ...(f.to ? { lte: day(f.to) } : {}) } } : {}),
  ...(f.currency ? { currency: cur && !cur.includes(f.currency.toUpperCase()) ? "-" : f.currency.toUpperCase() } : cur ? { currency: { in: cur } } : {}),
  ...(f.q ? { OR: [{ vendor: { contains: f.q } }, { note: { contains: f.q } }] } : {}),
});
const view = (e: { id: string; date: Date; amount: number; currency: string; vendor: string; note: string; createdByEmail: string; createdAt: Date }) => ({
  id: e.id, date: e.date.toISOString().slice(0, 10), amount: e.amount, currency: e.currency, vendor: e.vendor, note: e.note, createdBy: e.createdByEmail, createdAt: e.createdAt,
});

expensesRouter.get("/meta", async (_req, res) => res.json({ currencies: await currencies() }));

expensesRouter.get("/", async (req, res) => {
  const f = filters.parse(req.query);
  const rows = await prisma.expense.findMany({ where: where(f, await scopeCurrencies(req)), orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 500 });
  // totals per currency (never mixed) and per category within range
  const totals: Record<string, number> = {};
  for (const r of rows) totals[r.currency] = (totals[r.currency] ?? 0) + r.amount;
  res.json({ items: rows.map(view), totals: Object.entries(totals).map(([currency, amount]) => ({ currency, amount })), truncated: rows.length === 500 });
});

expensesRouter.get("/export", async (req, res) => {
  const rows = await prisma.expense.findMany({ where: where(filters.parse(req.query), await scopeCurrencies(req)), orderBy: { date: "asc" } });
  const head = ["Date", "Vendor", "Note", "Currency", "Amount", "Added by"];
  const lines = rows.map((r) => [r.date.toISOString().slice(0, 10), r.vendor, r.note, r.currency, (r.amount / 100).toFixed(2), r.createdByEmail].map(csvCell).join(","));
  res.type("text/csv; charset=utf-8").setHeader("Content-Disposition", 'attachment; filename="expenses.csv"');
  res.send([head.join(","), ...lines].join("\n"));
});

expensesRouter.post("/", async (req, res) => {
  const d = input.parse(req.body);
  const currency = await check(req, d);
  const u = actor(req);
  const e = await prisma.expense.create({ data: { ...d, currency, date: day(d.date), createdById: u.id.startsWith("key:") ? null : u.id, createdByEmail: u.email } });
  res.status(201).json(view(e));
});

expensesRouter.put("/:id", async (req, res) => {
  const d = input.parse(req.body);
  const cur = await prisma.expense.findUnique({ where: { id: req.params.id } });
  const sc = await scopeCurrencies(req);
  if (!cur || (sc && !sc.includes(cur.currency))) throw bad("Expense not found", 404);
  const currency = await check(req, d, cur);
  const e = await prisma.expense.update({ where: { id: req.params.id }, data: { ...d, currency, date: day(d.date) } });
  await audit(req, "expense_edited", `${e.vendor || e.note || "expense"} ${(e.amount / 100).toFixed(2)} ${e.currency}`);
  res.json(view(e));
});

expensesRouter.delete("/:id", async (req, res) => {
  const e = await prisma.expense.findUnique({ where: { id: req.params.id } });
  const sc = await scopeCurrencies(req);
  if (e && (!sc || sc.includes(e.currency))) {
    await prisma.expense.delete({ where: { id: e.id } });
    await audit(req, "expense_deleted", `${e.vendor || e.note || "expense"} ${(e.amount / 100).toFixed(2)} ${e.currency} (${e.createdByEmail})`);
  }
  res.json({ ok: true });
});
