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
import { ensureRoles } from "./permissions.js";
import { onlineStoreRouter } from "./routes/onlineStore.js";
import { analyticsRouter } from "./routes/analytics.js";
import { storeRouter, stripeWebhook, webhookBody } from "./routes/store.js";


const app = express();
app.set("trust proxy", 1); // behind the Next proxy; keeps req.ip meaningful
// Browser traffic comes through the Next proxy (same origin), so no CORS needed for credentials.

// Stripe needs the raw body, so register before express.json()
app.post("/api/webhooks/stripe", webhookBody, stripeWebhook);

app.use(express.json());
// uploaded product images: random ids, so they never change and can be cached hard
app.use("/uploads", express.static(UPLOAD_DIR, { maxAge: "365d", immutable: true, index: false, dotfiles: "deny" }));
app.use("/api/store", storeRouter);
app.use("/api/auth", authRouter);
app.use("/api/admin", requireAdmin);
app.use("/api/admin/markets", guard({ readOpen: true, write: ["markets.manage"] }), marketsRouter);
// browsing products/customers is also needed to build a draft order, so orders.manage may read them
app.use("/api/admin/products", guard({ read: ["products.view", "orders.manage"], write: ["products.manage"] }), productsRouter);
app.use("/api/admin/orders", guard({ read: ["orders.view"], write: ["orders.manage"] }), ordersRouter);
app.use("/api/admin/customers", guard({ read: ["customers.view", "orders.manage"], write: ["customers.manage", "orders.manage"] }), customersRouter);
app.use("/api/admin/analytics", guard({ write: ["analytics.view"] }), analyticsRouter);
app.use("/api/admin/drafts", guard({ read: ["orders.view"], write: ["orders.manage"] }), draftsRouter);
app.use("/api/admin/settings", guard({ readOpen: true, write: ["settings.manage"] }), settingsRouter);
app.use("/api/admin/online-store", guard({ write: ["online_store.manage"] }), onlineStoreRouter);
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
await ensureRoles();
app.listen(port, () => console.log(`api on :${port}`));
