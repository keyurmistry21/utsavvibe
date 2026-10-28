import { Router } from "express";
import { prisma } from "../db.js";

export const analyticsRouter = Router();

// Revenue is reported per market/currency; different currencies are never added together.
analyticsRouter.get("/summary", async (req, res) => {
  const days = Math.min(Number(req.query.days) || 30, 365);
  const since = new Date(Date.now() - days * 86400000);
  const orders = await prisma.order.findMany({
    where: { paymentStatus: "paid", createdAt: { gte: since } },
    include: { market: true, items: true },
  });

  const byMarket: Record<string, { code: string; currency: string; orders: number; revenue: number; tax: number; shipping: number }> = {};
  const daily: Record<string, Record<string, number>> = {};
  const top: Record<string, { title: string; quantity: number }> = {};

  for (const o of orders) {
    const m = (byMarket[o.market.code] ??= { code: o.market.code, currency: o.currency, orders: 0, revenue: 0, tax: 0, shipping: 0 });
    m.orders++;
    m.revenue += o.total;
    m.tax += o.tax;
    m.shipping += o.shipping;
    const day = o.createdAt.toISOString().slice(0, 10);
    ((daily[day] ??= {})[o.market.code] ??= 0);
    daily[day][o.market.code] += o.total;
    for (const i of o.items) (top[i.title] ??= { title: i.title, quantity: 0 }).quantity += i.quantity;
  }

  res.json({
    days,
    markets: Object.values(byMarket),
    daily: Object.entries(daily).sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, ...v })),
    topProducts: Object.values(top).sort((a, b) => b.quantity - a.quantity).slice(0, 10),
    customers: await prisma.customer.count(),
    pendingOrders: await prisma.order.count({ where: { status: "open", paymentStatus: "paid" } }),
  });
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
