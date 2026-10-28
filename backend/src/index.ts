import "dotenv/config";
import express from "express";
import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { UPLOAD_DIR } from "./storage.js";
import { requireAdmin } from "./auth.js";
import { authRouter } from "./routes/auth.js";
import { marketsRouter } from "./routes/markets.js";
import { productsRouter } from "./routes/products.js";
import { ordersRouter } from "./routes/orders.js";
import { customersRouter } from "./routes/customers.js";
import { draftsRouter } from "./routes/drafts.js";
import { settingsRouter } from "./routes/settings.js";
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
app.use("/api/admin/markets", marketsRouter);
app.use("/api/admin/products", productsRouter);
app.use("/api/admin/orders", ordersRouter);
app.use("/api/admin/customers", customersRouter);
app.use("/api/admin/analytics", analyticsRouter);
app.use("/api/admin/drafts", draftsRouter);
app.use("/api/admin/settings", settingsRouter);

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
app.listen(port, () => console.log(`api on :${port}`));
