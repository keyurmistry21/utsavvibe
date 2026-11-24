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

// ---- Shopify-style insights (doc §10): sales, orders, AOV, channels, staff and location performance, products, stock ----
const LOW_STOCK = 5;
type Cell = { currency: string; sales: number; orders: number };

async function scopeWhere(req: Parameters<typeof scopeCodes>[0], marketCode: string | null) {
  const scope = scopeCodes(req);
  if (scope && marketCode && !scope.includes(marketCode)) throw Object.assign(new Error("An admin hasn't given you access to that market."), { status: 403 });
  return marketCode ? { market: { code: marketCode } } : scope ? { market: { code: { in: scope } } } : {};
}

analyticsRouter.get("/insights", async (req, res) => {
  const { from, to, days } = range(req.query);
  const marketCode = req.query.market ? String(req.query.market).toUpperCase() : null;
  const where = await scopeWhere(req, marketCode);
  const [paid, pending, levels] = await Promise.all([
    prisma.order.findMany({ where: { paymentStatus: "paid", createdAt: { gte: from, lte: to }, ...where }, include: { items: true, market: { select: { code: true } } } }),
    prisma.order.count({ where: { paymentStatus: "pending", status: { not: "cancelled" }, createdAt: { gte: from, lte: to }, ...where } }),
    prisma.inventoryLevel.findMany({
      where: { quantity: { lte: LOW_STOCK }, variant: { product: { status: "active", trackInventory: true } }, ...(marketCode ? { market: { code: marketCode } } : scopeCodes(req) ? { market: { code: { in: scopeCodes(req)! } } } : {}) },
      include: { market: { select: { code: true } }, variant: { select: { title: true, sku: true, product: { select: { title: true } } } } },
      orderBy: { quantity: "asc" }, take: 50,
    }),
  ]);

  // money is only ever added within one currency
  const total: Record<string, Cell> = {};
  const channel: Record<string, Record<string, Cell & { channel: string }>> = {};
  const staff: Record<string, { id: string; name: string; currency: string; sales: number; orders: number }> = {};
  const loc: Record<string, { name: string; currency: string; sales: number; orders: number }> = {};
  const variants: Record<string, { title: string; currency: string; quantity: number; revenue: number }> = {};
  const daily: Record<string, Record<string, number>> = {};
  const hourly: Record<string, number[]> = {};
  for (const o of paid) {
    const t = (total[o.currency] ??= { currency: o.currency, sales: 0, orders: 0 });
    t.sales += o.total - o.tax; t.orders++; // net sales: tax is not income
    const ch = o.channel === "in_store" ? "in_store" : "online";
    const c = ((channel[o.currency] ??= {})[ch] ??= { currency: o.currency, channel: ch, sales: 0, orders: 0 });
    c.sales += o.total - o.tax; c.orders++;
    if (ch === "in_store") {
      const sk = `${o.salespersonId ?? "?"}|${o.currency}`;
      const s = (staff[sk] ??= { id: o.salespersonId ?? "", name: o.salespersonName ?? "Unknown", currency: o.currency, sales: 0, orders: 0 });
      s.sales += o.total - o.tax; s.orders++;
      const lk = `${o.locationName ?? "Store"}|${o.currency}`;
      const l = (loc[lk] ??= { name: o.locationName ?? "Store", currency: o.currency, sales: 0, orders: 0 });
      l.sales += o.total - o.tax; l.orders++;
    }
    for (const i of o.items) {
      const vk = `${i.title}|${o.currency}`;
      const v = (variants[vk] ??= { title: i.title, currency: o.currency, quantity: 0, revenue: 0 });
      v.quantity += i.quantity; v.revenue += i.unitPrice * i.quantity;
    }
    const day = o.createdAt.toISOString().slice(0, 10);
    ((daily[o.currency] ??= {})[day] ??= 0);
    daily[o.currency][day] += o.total - o.tax;
    (hourly[o.currency] ??= Array(24).fill(0))[o.createdAt.getUTCHours()] += o.total - o.tax;
  }
  const top = (rows: { sales: number; currency: string }[]) => Object.values(rows.reduce<Record<string, (typeof rows)[number]>>((m, r) => ((!m[r.currency] || r.sales > m[r.currency].sales) && (m[r.currency] = r), m), {}));
  res.json({
    days, from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10),
    totals: Object.values(total).map((t) => ({ ...t, aov: t.orders ? Math.round(t.sales / t.orders) : 0 })),
    pending,
    channels: Object.values(channel).flatMap((x) => Object.values(x)),
    salespeople: Object.values(staff).sort((a, b) => b.sales - a.sales),
    locations: Object.values(loc).sort((a, b) => b.sales - a.sales),
    topSalesperson: top(Object.values(staff)),
    topLocation: top(Object.values(loc)),
    topVariants: Object.values(variants).sort((a, b) => b.quantity - a.quantity).slice(0, 15),
    daily: Object.entries(daily).map(([currency, d]) => ({ currency, points: Object.entries(d).sort(([a], [b]) => a.localeCompare(b)).map(([date, sales]) => ({ date, sales })) })),
    hourly: Object.entries(hourly).map(([currency, hours]) => ({ currency, hours })),
    lowStock: levels.map((l) => ({ product: l.variant.product.title, variant: l.variant.title === "Default" ? "" : l.variant.title, sku: l.sku || l.variant.sku, market: l.market.code, quantity: l.quantity })),
  });
});

// ---- Storefront traffic (first-party events recorded by the storefront tracker; doc §8.6) ----
analyticsRouter.get("/traffic", async (req, res) => {
  const { from, to, days } = range(req.query);
  const marketCode = req.query.market ? String(req.query.market).toUpperCase() : null;
  const scope = scopeCodes(req);
  if (scope && marketCode && !scope.includes(marketCode)) return void res.status(403).json({ error: "An admin hasn't given you access to that market." });
  const ev = await prisma.trackEvent.findMany({
    where: { createdAt: { gte: from, lte: to }, ...(marketCode ? { market: marketCode } : scope ? { market: { in: scope } } : {}) },
    orderBy: { createdAt: "asc" }, take: 200_000,
  });
  type S = { source: string; medium: string; campaign: string; steps: Set<string>; last: string; orderNo?: number };
  const sessions = new Map<string, S>();
  const pages: Record<string, { path: string; title: string; views: number; secs: number; timed: number; exits: number }> = {};
  const page = (p: string, t: string) => (pages[p] ??= { path: p, title: t, views: 0, secs: 0, timed: 0, exits: 0 });
  for (const e of ev) {
    const s = sessions.get(e.sessionId) ?? { source: e.source, medium: e.medium, campaign: e.campaign, steps: new Set<string>(), last: "" };
    sessions.set(e.sessionId, s);
    if (e.type === "page_view") { s.steps.add("page_view"); s.last = e.path; page(e.path, e.title).views++; }
    else if (e.type === "page_leave") { const p = page(e.path, e.title); if (e.durationSec != null) { p.secs += e.durationSec; p.timed++; } }
    else { s.steps.add(e.type); if (e.type === "purchase") { const m = e.path.match(/\/order\/(\d+)$/); if (m) s.orderNo = Number(m[1]); } }
  }
  const funnel = { sessions: sessions.size, view_item: 0, add_to_cart: 0, begin_checkout: 0, purchase: 0 };
  // revenue per source: the purchase event carries the order number in its path, so look those orders up (paid only, net of tax)
  const nums = [...sessions.values()].map((x) => x.orderNo).filter((n): n is number => !!n);
  const paidOrders = nums.length ? await prisma.order.findMany({ where: { number: { in: nums }, paymentStatus: "paid" }, select: { number: true, total: true, tax: true, currency: true } }) : [];
  const byNo = new Map(paidOrders.map((o) => [o.number, o]));
  const src: Record<string, { source: string; medium: string; campaign: string; sessions: number; add_to_cart: number; purchase: number; revenue: Record<string, number> }> = {};
  for (const s of sessions.values()) {
    for (const k of ["view_item", "add_to_cart", "begin_checkout", "purchase"] as const) if (s.steps.has(k)) funnel[k]++;
    if (s.last && !s.steps.has("purchase")) page(s.last, "").exits++;
    const k = `${s.source}|${s.medium}|${s.campaign}`;
    const r = (src[k] ??= { source: s.source, medium: s.medium, campaign: s.campaign, sessions: 0, add_to_cart: 0, purchase: 0, revenue: {} });
    const po = s.orderNo ? byNo.get(s.orderNo) : undefined;
    if (po) r.revenue[po.currency] = (r.revenue[po.currency] ?? 0) + po.total - po.tax;
    r.sessions++; if (s.steps.has("add_to_cart")) r.add_to_cart++; if (s.steps.has("purchase")) r.purchase++;
  }
  const rows = Object.values(pages).map((p) => ({ path: p.path, title: p.title, views: p.views, avgSeconds: p.timed ? Math.round(p.secs / p.timed) : null, exits: p.exits, exitRate: p.views ? Math.round((p.exits / p.views) * 100) : 0 }));
  res.json({
    days, funnel,
    conversionRate: funnel.sessions ? Math.round((funnel.purchase / funnel.sessions) * 1000) / 10 : 0,
    sources: Object.values(src).sort((a, b) => b.sessions - a.sessions).slice(0, 20),
    topPages: rows.sort((a, b) => b.views - a.views).slice(0, 15),
    exitPages: [...rows].filter((r) => r.exits > 0).sort((a, b) => b.exits - a.exits).slice(0, 10),
    truncated: ev.length >= 200_000,
  });
});

// ---- Home page: today at a glance (sales vs yesterday, week trend, to-do counts, recent orders, stock, visitors) ----
const startOfUtcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

analyticsRouter.get("/home", async (req, res) => {
  const marketCode = req.query.market ? String(req.query.market).toUpperCase() : null;
  const where = await scopeWhere(req, marketCode);
  const scope = scopeCodes(req);
  const mktCodes = marketCode ? [marketCode] : scope;
  const today = startOfUtcDay(new Date());
  const DAY = 86400000;
  const d6 = new Date(today.getTime() - 6 * DAY), d13 = new Date(today.getTime() - 13 * DAY), yest = new Date(today.getTime() - DAY);

  const [paid, recent, toFulfil, unpaid, highRisk, levels, visitors, buyers] = await Promise.all([
    prisma.order.findMany({ where: { paymentStatus: "paid", createdAt: { gte: d13 }, ...where }, select: { createdAt: true, total: true, tax: true, currency: true, channel: true, items: { select: { title: true, quantity: true } } } }),
    prisma.order.findMany({ where: { status: { not: "draft" }, ...where }, orderBy: { createdAt: "desc" }, take: 8, select: { id: true, number: true, total: true, currency: true, status: true, paymentStatus: true, channel: true, createdAt: true, riskLevel: true, shippingName: true, customer: { select: { name: true } }, market: { select: { code: true } } } }),
    prisma.order.count({ where: { status: "open", paymentStatus: "paid", ...where } }),
    prisma.order.count({ where: { status: "open", paymentStatus: "pending", createdAt: { gte: new Date(Date.now() - DAY) }, ...where } }),
    prisma.order.count({ where: { riskLevel: "high", status: { in: ["open"] }, ...where } }),
    prisma.inventoryLevel.findMany({
      where: { quantity: { lte: LOW_STOCK }, variant: { product: { status: "active", trackInventory: true, continueSelling: false } }, ...(mktCodes ? { market: { code: { in: mktCodes } } } : {}) },
      include: { market: { select: { code: true } }, variant: { select: { title: true, sku: true, product: { select: { title: true } } } } },
      orderBy: { quantity: "asc" }, take: 100,
    }),
    prisma.trackEvent.findMany({ where: { createdAt: { gte: d6 }, type: "page_view", ...(mktCodes ? { market: { in: mktCodes } } : {}) }, distinct: ["sessionId"], select: { sessionId: true, createdAt: true } }),
    prisma.trackEvent.findMany({ where: { createdAt: { gte: d6 }, type: "purchase", ...(mktCodes ? { market: { in: mktCodes } } : {}) }, distinct: ["sessionId"], select: { sessionId: true } }),
  ]);

  type C = { currency: string; today: number; yesterday: number; week: number; prevWeek: number; ordersToday: number; ordersWeek: number; series: number[] };
  const cur: Record<string, C> = {};
  const top: Record<string, { title: string; quantity: number }> = {};
  for (const o of paid) {
    const c = (cur[o.currency] ??= { currency: o.currency, today: 0, yesterday: 0, week: 0, prevWeek: 0, ordersToday: 0, ordersWeek: 0, series: Array(7).fill(0) });
    const net = o.total - o.tax;
    if (o.createdAt >= today) { c.today += net; c.ordersToday++; }
    else if (o.createdAt >= yest) c.yesterday += net;
    if (o.createdAt >= d6) {
      c.week += net; c.ordersWeek++;
      c.series[Math.min(6, Math.floor((startOfUtcDay(o.createdAt).getTime() - d6.getTime()) / DAY))] += net;
      for (const i of o.items) (top[i.title] ??= { title: i.title, quantity: 0 }).quantity += i.quantity;
    } else c.prevWeek += net;
  }
  const lowStock = levels.filter((l) => l.quantity > 0), out = levels.filter((l) => l.quantity <= 0);
  const sessions = visitors.length;
  res.json({
    currencies: Object.values(cur),
    todo: { toFulfil, unpaid, highRisk, lowStock: lowStock.length, outOfStock: out.length },
    recent: recent.map((o) => ({ id: o.id, number: o.number, total: o.total, currency: o.currency, status: o.status, paymentStatus: o.paymentStatus, channel: o.channel, createdAt: o.createdAt, risk: o.riskLevel, market: o.market.code, customer: o.customer?.name || o.shippingName || "Guest" })),
    topProducts: Object.values(top).sort((a, b) => b.quantity - a.quantity).slice(0, 5),
    stock: [...out, ...lowStock].slice(0, 6).map((l) => ({ product: l.variant.product.title, variant: l.variant.title === "Default" ? "" : l.variant.title, sku: l.sku || l.variant.sku, market: l.market.code, quantity: l.quantity })),
    visitors: { sessions, purchases: buyers.length, conversion: sessions ? Math.round((buyers.length / sessions) * 1000) / 10 : 0, today: visitors.filter((v) => v.createdAt >= today).length },
  });
});

// ---- Tax collected by province / state (for filing): paid orders, per currency, grouped by the delivery region ----
analyticsRouter.get("/tax", async (req, res) => {
  const { from, to } = range(req.query);
  const marketCode = req.query.market ? String(req.query.market).toUpperCase() : null;
  const where = await scopeWhere(req, marketCode);
  const orders = await prisma.order.findMany({ where: { paymentStatus: "paid", createdAt: { gte: from, lte: to }, ...where }, select: { tax: true, taxBreakdown: true, total: true, refundedAmount: true, currency: true, shippingAddress: true, locationName: true, channel: true, market: { select: { code: true, regions: { select: { code: true, name: true } } } } } });
  const rows: Record<string, { currency: string; market: string; region: string; orders: number; sales: number; tax: number; parts: Record<string, number> }> = {};
  for (const o of orders) {
    let code = "";
    try { code = String((JSON.parse(o.shippingAddress) as { region?: string }).region ?? "").toUpperCase(); } catch { /* no address */ }
    const name = o.market.regions.find((r) => r.code === code)?.name ?? (code || (o.channel === "in_store" ? `In-store${o.locationName ? ` (${o.locationName})` : ""}` : "No region"));
    const k = `${o.market.code}|${name}`;
    const r = (rows[k] ??= { currency: o.currency, market: o.market.code, region: name, orders: 0, sales: 0, tax: 0, parts: {} });
    // refunds reduce the sale pro rata, so the report matches what was really kept
    const kept = o.total ? 1 - o.refundedAmount / o.total : 1;
    r.orders++; r.sales += Math.round((o.total - o.tax) * kept); r.tax += Math.round(o.tax * kept);
    // GST / PST / HST / QST separately (what the tax return asks for); orders without a split count under "Tax"
    let parts: { name: string; amount: number }[] = [];
    try { const p = JSON.parse(o.taxBreakdown ?? "[]"); if (Array.isArray(p)) parts = p; } catch { /* none */ }
    if (!parts.length && o.tax) parts = [{ name: "Tax", amount: o.tax }];
    for (const p of parts) r.parts[p.name] = (r.parts[p.name] ?? 0) + Math.round(p.amount * kept);
  }
  res.json(Object.values(rows).sort((a, b) => a.market.localeCompare(b.market) || b.tax - a.tax));
});
