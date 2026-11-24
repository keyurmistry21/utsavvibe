import "dotenv/config";
import express from "express";
import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { UPLOAD_DIR } from "./storage.js";
import { guard, requireAdmin } from "./auth.js";
import { authRouter } from "./routes/auth.js";
import { marketsRouter } from "./routes/markets.js";
import { productsRouter } from "./routes/products.js";
import { ordersRouter } from "./routes/orders.js";
import { customersRouter } from "./routes/customers.js";
import { draftsRouter } from "./routes/drafts.js";
import { settingsRouter } from "./routes/settings.js";
import { usersRouter, rolesRouter } from "./routes/users.js";
import { locationsRouter, ensureDefaultLocation, ensureStockLevels } from "./routes/locations.js";
import { policiesRouter } from "./routes/policies.js";
import { paymentsRouter } from "./routes/payments.js";
import { ensureRoles } from "./permissions.js";
import { onlineStoreRouter } from "./routes/onlineStore.js";
import { collectionsRouter } from "./routes/collections.js";
import { blogRouter } from "./routes/blog.js";
import { giftCardsRouter } from "./routes/giftCards.js";
import { shippingLabelsRouter } from "./routes/shippingLabels.js";
import { expensesRouter } from "./routes/expenses.js";
import { analyticsRouter } from "./routes/analytics.js";
import { posRouter } from "./routes/pos.js";
import { storeRouter, stripeWebhook, webhookBody } from "./routes/store.js";
import { integrationsRouter } from "./routes/integrations.js";
import { feedsRouter } from "./routes/feeds.js";
import { loadSecret } from "./secrets.js";
import { startAbandonedJob } from "./abandoned.js";
import { rateLimit } from "./rateLimit.js";
import helmet from "helmet";


const app = express();
app.set("trust proxy", 1); // behind the Next proxy; keeps req.ip meaningful
app.disable("x-powered-by");
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" }, hsts: process.env.NODE_ENV === "production" }));
// Browser traffic comes through the Next proxy (same origin), so no CORS needed for credentials.

// Stripe needs the raw body, so register before express.json()
app.post("/api/webhooks/stripe", webhookBody, stripeWebhook);

app.use(express.json({ limit: "1mb" }));
// uploaded product images: random ids, so they never change and can be cached hard
app.use("/uploads", express.static(UPLOAD_DIR, { maxAge: "365d", immutable: true, index: false, dotfiles: "deny" }));
// Abuse limits per IP (in memory). Checkout is the tight one: it creates orders and Stripe sessions, a target for card testing.
app.use("/api/store/checkout", rateLimit({ windowMs: 10 * 60_000, max: 10, message: "Too many checkout attempts. Please wait a few minutes." }));
app.use("/api/store/track", rateLimit({ windowMs: 60_000, max: 120 }));
app.use("/api/store/quote", rateLimit({ windowMs: 60_000, max: 90 }));
app.use("/api/store/feeds", rateLimit({ windowMs: 60_000, max: 60 }));
app.use("/api/store", rateLimit({ windowMs: 60_000, max: 600 }));
app.use("/api/admin", rateLimit({ windowMs: 60_000, max: 900 }));
app.use("/api/store/feeds", feedsRouter);
app.use("/api/store", storeRouter);
app.use("/api/auth", authRouter);
app.use("/api/admin", requireAdmin);
app.use("/api/admin/markets", guard({ readOpen: true, write: ["markets.manage"] }), marketsRouter);
// browsing products/customers is also needed to build a draft order, so orders.manage may read them
app.use("/api/admin/products", guard({ read: ["products.view", "orders.manage"], write: ["products.manage"] }), productsRouter);
app.use("/api/admin/orders", guard({ read: ["orders.view"], write: ["orders.manage"] }), ordersRouter);
app.use("/api/admin/customers", guard({ read: ["customers.view", "orders.manage"], write: ["customers.manage", "orders.manage"] }), customersRouter);
app.use("/api/admin/integrations", guard({ write: ["integrations.manage"] }), integrationsRouter);
app.use("/api/admin/expenses", guard({ read: ["expenses.view"], write: ["expenses.manage"] }), expensesRouter);
app.use("/api/admin/analytics", guard({ write: ["analytics.view"] }), analyticsRouter);
app.use("/api/admin/pos", guard({ read: ["orders.manage"], write: ["orders.manage"] }), posRouter);
app.use("/api/admin/drafts", guard({ read: ["orders.view"], write: ["orders.manage"] }), draftsRouter);
app.use("/api/admin/settings", guard({ readOpen: true, write: ["settings.manage"] }), settingsRouter);
app.use("/api/admin/online-store", guard({ write: ["online_store.manage"] }), onlineStoreRouter);
app.use("/api/admin/collections", guard({ read: ["products.view"], write: ["products.manage"] }), collectionsRouter);
app.use("/api/admin/blog", guard({ write: ["online_store.manage"] }), blogRouter);
app.use("/api/admin/gift-cards", guard({ read: ["gift_cards.view"], write: ["gift_cards.manage"] }), giftCardsRouter);
app.use("/api/admin/orders", guard({ read: ["orders.view"], write: ["orders.manage"] }), shippingLabelsRouter);
app.use("/api/admin/locations", guard({ write: ["settings.manage"] }), locationsRouter);
app.use("/api/admin/policies", guard({ write: ["settings.manage"] }), policiesRouter);
app.use("/api/admin/payments", guard({ write: ["settings.manage"] }), paymentsRouter);
app.use("/api/admin/users", guard({ write: ["users.manage"] }), usersRouter);
app.use("/api/admin/roles", guard({ write: ["users.manage"] }), rolesRouter);

const onError: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) return void res.status(400).json({ error: "validation", issues: err.issues });
  // Prisma unique-constraint violation -> a message the form can show next to the field
  if (err.code === "P2002") {
    const t = String((err.meta as { target?: unknown })?.target ?? "");
    return void res.status(409).json({ error: /sku/i.test(t) ? "This SKU is already used by another product" : /email/i.test(t) ? "A customer with this email already exists" : /handle/i.test(t) ? "This URL handle is already used by another product" : "That value is already in use" });
  }
  const status = err.status ?? 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: err.message ?? "server error" });
};
app.use(onError);

const port = Number(process.env.PORT) || 4000;
if (process.env.NODE_ENV === "production") {
  if (!process.env.APP_SECRET) console.warn("WARNING: set APP_SECRET in backend/.env (signs login tokens, encrypts 2FA secrets)");
  if (!/^https:/.test(process.env.STOREFRONT_URL ?? "")) console.warn("WARNING: STOREFRONT_URL should be https:// in production");
}
await loadSecret();
await ensureRoles();
await ensureDefaultLocation();
await ensureStockLevels();
startAbandonedJob();
app.listen(port, () => console.log(`api on :${port}`));
