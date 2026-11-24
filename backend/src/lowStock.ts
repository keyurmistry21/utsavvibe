import { prisma } from "./db.js";
import { esc } from "./emails.js";
import { sendMail, storeName } from "./mail.js";
import { onHand } from "./stock.js";

export const LOW_STOCK_LEVEL = 5;

// After stock was taken: if a tracked item just fell to the low level (it was above it before), email the owners once.
// Never throws: a mail problem must not fail a payment or a sale.
export async function alertLowStock(items: { variantId: string | null; quantity: number }[], marketId: string) {
  try {
    const hits: { name: string; sku: string | null; left: number }[] = [];
    for (const it of items) {
      if (!it.variantId) continue;
      const v = await prisma.variant.findUnique({ where: { id: it.variantId }, select: { title: true, sku: true, product: { select: { title: true, trackInventory: true, continueSelling: true, status: true } } } });
      if (!v || !v.product.trackInventory || v.product.continueSelling || v.product.status !== "active") continue;
      const left = await onHand(prisma, it.variantId, marketId);
      if (left <= LOW_STOCK_LEVEL && left + it.quantity > LOW_STOCK_LEVEL) hits.push({ name: v.title === "Default" ? v.product.title : `${v.product.title} — ${v.title}`, sku: v.sku, left: Math.max(0, left) });
    }
    if (!hits.length) return;
    const market = await prisma.market.findUnique({ where: { id: marketId }, select: { code: true } });
    const owners = await prisma.adminUser.findMany({ where: { active: true, role: { name: "Owner", isSystem: true } }, select: { email: true } });
    const site = process.env.STOREFRONT_URL ?? "";
    const rows = hits.map((h) => `<li><b>${esc(h.name)}</b>${h.sku ? ` (${esc(h.sku)})` : ""}: ${h.left === 0 ? "sold out" : `${h.left} left`} in ${esc(market?.code ?? "")}</li>`).join("");
    for (const o of owners)
      await sendMail({
        to: o.email, kind: "low_stock",
        subject: `Low stock at ${storeName()}: ${hits.map((h) => h.name).slice(0, 2).join(", ")}${hits.length > 2 ? "…" : ""}`,
        html: `<p>These items are running low in the ${esc(market?.code ?? "")} market:</p><ul>${rows}</ul><p><a href="${esc(site)}/admin/products">Open products</a></p>`,
        text: `Running low in ${market?.code ?? ""}:\n${hits.map((h) => `- ${h.name}${h.sku ? ` (${h.sku})` : ""}: ${h.left} left`).join("\n")}\n${site}/admin/products`,
      });
  } catch (e) {
    console.error("low stock alert failed", (e as Error).message);
  }
}
