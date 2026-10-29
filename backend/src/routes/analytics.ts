import { Router } from "express";
import { prisma } from "../db.js";
import { scopeCodes } from "../auth.js";

export const analyticsRouter = Router();

const dayStart = (s: string) => new Date(`${s}T00:00:00.000Z`);
const dayEnd = (s: string) => new Date(`${s}T23:59:59.999Z`);
const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(dayStart(s).getTime());

// Range = ?from=YYYY-MM-DD&to=YYYY-MM-DD (inclusive, UTC days), else the last ?days=N. `market` limits sales to that market and expenses to its currency.
function range(q: Record<string, unknown>) {
  if (isDate(q.from) && isDate(q.to)) {
    const from = dayStart(q.from), to = dayEnd(q.to);
    if (from > to) throw Object.assign(new Error("The start date is after the end date"), { status: 400 });
    if (to.getTime() - from.getTime() > 5 * 366 * 86400000) throw Object.assign(new Error("Pick a range of 5 years or less"), { status: 400 });
    return { from, to, days: Math.ceil((to.getTime() - from.getTime()) / 86400000) };
  }
  const days = Math.min(Math.max(Number(q.days) || 30, 1), 1830);
  return { from: new Date(Date.now() - days * 86400000), to: new Date(), days };
}

type Row = { currency: string; markets: string[]; orders: number; revenue: number; tax: number; shipping: number; net: number; expenses: number; expenseCount: number; profit: number };

// Revenue is reported per currency; different currencies are never added together.
// revenue = what customers paid (incl. tax + shipping); net sales = revenue - tax; profit = net sales - expenses.
analyticsRouter.get("/summary", async (req, res) => {
  const { from, to, days } = range(req.query);
  const marketCode = req.query.market ? String(req.query.market).toUpperCase() : null;
  const scope = scopeCodes(req); // staff limited to some markets only see those
  if (scope && marketCode && !scope.includes(marketCode)) return void res.status(403).json({ error: "An admin hasn't given you access to that market." });
  const mkt = marketCode ? await prisma.market.findFirst({ where: { code: marketCode } }) : null;
  const scopeCur = scope ? (await prisma.market.findMany({ where: { code: { in: scope } }, select: { currency: true } })).map((m) => m.currency) : null;
  const marketWhere = marketCode ? { market: { code: marketCode } } : scope ? { market: { code: { in: scope } } } : {};
  const curWhere = mkt ? { currency: mkt.currency } : scopeCur ? { currency: { in: scopeCur } } : {};
  const [orders, expenses] = await Promise.all([
    prisma.order.findMany({ where: { paymentStatus: "paid", createdAt: { gte: from, lte: to }, ...marketWhere }, include: { market: true, items: true } }),
    prisma.expense.findMany({ where: { date: { gte: from, lte: to }, ...curWhere } }),
  ]);

  const byMarket: Record<string, { code: string; currency: string; orders: number; revenue: number; tax: number; shipping: number }> = {};
  const cur: Record<string, Row> = {};
  const row = (c: string) => (cur[c] ??= { currency: c, markets: [], orders: 0, revenue: 0, tax: 0, shipping: 0, net: 0, expenses: 0, expenseCount: 0, profit: 0 });
  const daily: Record<string, Record<string, number>> = {};
  const top: Record<string, { title: string; quantity: number }> = {};

  for (const o of orders) {
    const m = (byMarket[o.market.code] ??= { code: o.market.code, currency: o.currency, orders: 0, revenue: 0, tax: 0, shipping: 0 });
    m.orders++; m.revenue += o.total; m.tax += o.tax; m.shipping += o.shipping;
    const r = row(o.currency);
    r.orders++; r.revenue += o.total; r.tax += o.tax; r.shipping += o.shipping;
    if (!r.markets.includes(o.market.code)) r.markets.push(o.market.code);
    const day = o.createdAt.toISOString().slice(0, 10);
    ((daily[day] ??= {})[o.market.code] ??= 0);
    daily[day][o.market.code] += o.total;
    for (const i of o.items) (top[i.title] ??= { title: i.title, quantity: 0 }).quantity += i.quantity;
  }
  for (const e of expenses) {
    const r = row(e.currency);
    r.expenses += e.amount; r.expenseCount++;
  }
  for (const r of Object.values(cur)) { r.net = r.revenue - r.tax; r.profit = r.net - r.expenses; }

  // the same-length period right before this one, for "vs previous period" arrows
  const span = to.getTime() - from.getTime();
  const pFrom = new Date(from.getTime() - span - 1), pTo = new Date(from.getTime() - 1);
  const [pOrders, pExpenses] = await Promise.all([
    prisma.order.findMany({ where: { paymentStatus: "paid", createdAt: { gte: pFrom, lte: pTo }, ...marketWhere }, select: { currency: true, total: true, tax: true } }),
    prisma.expense.findMany({ where: { date: { gte: pFrom, lte: pTo }, ...curWhere }, select: { currency: true, amount: true } }),
  ]);
  const previous: Record<string, { orders: number; revenue: number; net: number; expenses: number; profit: number }> = {};
  const pc = (c: string) => (previous[c] ??= { orders: 0, revenue: 0, net: 0, expenses: 0, profit: 0 });
  for (const o of pOrders) { const r = pc(o.currency); r.orders++; r.revenue += o.total; r.net += o.total - o.tax; }
  for (const e of pExpenses) pc(e.currency).expenses += e.amount;
  for (const r of Object.values(previous)) r.profit = r.net - r.expenses;

  res.json({
    previous,
    days, from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10),
    markets: Object.values(byMarket),
    currencies: Object.values(cur),
    daily: Object.entries(daily).sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, ...v })),
    topProducts: Object.values(top).sort((a, b) => b.quantity - a.quantity).slice(0, 10),
    customers: await prisma.customer.count(),
    pendingOrders: await prisma.order.count({ where: { status: "open", paymentStatus: "paid" } }),
  });
});

// Revenue, expenses and profit per calendar year (UTC), per currency.
analyticsRouter.get("/yearly", async (req, res) => {
  const marketCode = req.query.market ? String(req.query.market).toUpperCase() : null;
  const scope = scopeCodes(req);
  if (scope && marketCode && !scope.includes(marketCode)) return void res.status(403).json({ error: "An admin hasn't given you access to that market." });
  const mkt = marketCode ? await prisma.market.findFirst({ where: { code: marketCode } }) : null;
  const scopeCur = scope ? (await prisma.market.findMany({ where: { code: { in: scope } }, select: { currency: true } })).map((m) => m.currency) : null;
  const [orders, expenses] = await Promise.all([
    prisma.order.findMany({ where: { paymentStatus: "paid", ...(marketCode ? { market: { code: marketCode } } : scope ? { market: { code: { in: scope } } } : {}) }, select: { createdAt: true, currency: true, total: true, tax: true } }),
    prisma.expense.findMany({ where: mkt ? { currency: mkt.currency } : scopeCur ? { currency: { in: scopeCur } } : {}, select: { date: true, currency: true, amount: true } }),
  ]);
  const t: Record<string, { year: number; currency: string; orders: number; revenue: number; tax: number; expenses: number; net: number; profit: number }> = {};
  const cell = (y: number, c: string) => (t[`${y}|${c}`] ??= { year: y, currency: c, orders: 0, revenue: 0, tax: 0, expenses: 0, net: 0, profit: 0 });
  for (const o of orders) { const c = cell(o.createdAt.getUTCFullYear(), o.currency); c.orders++; c.revenue += o.total; c.tax += o.tax; }
  for (const e of expenses) cell(e.date.getUTCFullYear(), e.currency).expenses += e.amount;
  const rows = Object.values(t).map((c) => ({ ...c, net: c.revenue - c.tax, profit: c.revenue - c.tax - c.expenses })).sort((a, b) => b.year - a.year || a.currency.localeCompare(b.currency));
  res.json(rows);
});

// Setup checklist + sidebar badge for the admin home.
analyticsRouter.get("/status", async (_req, res) => {
  const [products, activeProducts, markets, toFulfil] = await Promise.all([
    prisma.product.count(),
    prisma.product.count({ where: { status: "active" } }),
    prisma.market.count({ where: { active: true } }),
    prisma.order.count({ where: { status: "open", paymentStatus: "paid" } }),
  ]);
  res.json({ products, activeProducts, markets, toFulfil, stripeConfigured: !!process.env.STRIPE_SECRET_KEY, webhookConfigured: !!process.env.STRIPE_WEBHOOK_SECRET });
});
