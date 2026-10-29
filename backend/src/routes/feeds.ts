import { Router } from "express";
import { prisma, parseJson } from "../db.js";
import { esc } from "../emails.js";
import { htmlToText } from "../html.js";
import { csvCell } from "../csv.js";
import { canSell } from "../stock.js";
import { imageUrls } from "../storage.js";
import { storeName } from "../mail.js";

// Public product feeds for Google Merchant Center (XML) and Meta Commerce Manager / Instagram Shopping (CSV).
// One feed per market, because currency, price and shipping differ. Add the URL under "scheduled fetch" in each tool.
export const feedsRouter = Router();

const site = () => (process.env.STOREFRONT_URL ?? "http://localhost:5173").replace(/\/$/, "");
const price = (minor: number, cur: string) => `${(minor / 100).toFixed(2)} ${cur}`;
const gtin = (b?: string | null) => (b && /^\d{8}$|^\d{12,14}$/.test(b) ? b : "");

async function rows(code: string) {
  const market = await prisma.market.findFirst({ where: { code: code.toUpperCase(), active: true }, include: { shippingRates: true } });
  if (!market) return null;
  const products = await prisma.product.findMany({
    where: { status: "active", isGiftCard: false, markets: { some: { marketId: market.id } } },
    include: { images: { orderBy: { position: "asc" } }, variants: { include: { prices: { where: { marketId: market.id } } } } },
    orderBy: { createdAt: "desc" },
  });
  const out = products.flatMap((p) => {
    const base = `${site()}/${market.code.toLowerCase()}/products/${p.handle}`;
    const imgs = p.images.map((i) => site() + imageUrls(i.id).url);
    const desc = (htmlToText(p.description) || p.title).slice(0, 5000);
    return p.variants.filter((v) => v.prices[0]).map((v) => {
      const opts = parseJson<Record<string, string>>(v.options, {});
      const pr = v.prices[0];
      const onSale = pr.compareAt != null && pr.compareAt > pr.amount;
      const key = (re: RegExp) => Object.entries(opts).find(([k]) => re.test(k))?.[1] ?? "";
      return {
        id: v.sku || v.id,
        group: p.id,
        title: v.title === "Default" ? p.title : `${p.title} - ${v.title}`,
        desc,
        link: p.variants.length > 1 ? `${base}?variant=${v.id}` : base,
        image: imgs[0] ?? "",
        more: imgs.slice(1, 10),
        available: canSell(p, v.inventory) ? "in_stock" : "out_of_stock",
        price: price(onSale ? pr.compareAt! : pr.amount, market.currency),
        sale: onSale ? price(pr.amount, market.currency) : "",
        brand: p.vendor || storeName(),
        gtin: gtin(v.barcode),
        mpn: v.sku ?? "",
        type: p.productType,
        size: key(/size/i),
        color: key(/colou?r/i),
        weightG: v.weightG,
        qty: p.trackInventory ? Math.max(0, v.inventory) : 100,
      };
    });
  });
  return { market, items: out };
}

feedsRouter.get("/google/:code.xml", async (req, res) => {
  const f = await rows(req.params.code);
  if (!f) return void res.status(404).send("not found");
  const rate = f.market.shippingRates[0];
  const countries = parseJson<string[]>(f.market.countries, []);
  const item = (i: (typeof f.items)[number]) => `<item>
<g:id>${esc(i.id)}</g:id><g:item_group_id>${esc(i.group)}</g:item_group_id>
<title>${esc(i.title.slice(0, 150))}</title><description>${esc(i.desc)}</description>
<link>${esc(i.link)}</link>${i.image ? `<g:image_link>${esc(i.image)}</g:image_link>` : ""}${i.more.map((u) => `<g:additional_image_link>${esc(u)}</g:additional_image_link>`).join("")}
<g:availability>${i.available}</g:availability><g:condition>new</g:condition>
<g:price>${esc(i.price)}</g:price>${i.sale ? `<g:sale_price>${esc(i.sale)}</g:sale_price>` : ""}
<g:brand>${esc(i.brand)}</g:brand>${i.gtin ? `<g:gtin>${i.gtin}</g:gtin>` : ""}${i.mpn ? `<g:mpn>${esc(i.mpn)}</g:mpn>` : ""}${!i.gtin && !i.mpn ? "<g:identifier_exists>no</g:identifier_exists>" : ""}
${i.type ? `<g:product_type>${esc(i.type)}</g:product_type>` : ""}${i.size ? `<g:size>${esc(i.size)}</g:size>` : ""}${i.color ? `<g:color>${esc(i.color)}</g:color>` : ""}
${i.weightG ? `<g:shipping_weight>${i.weightG} g</g:shipping_weight>` : ""}${rate ? countries.slice(0, 20).map((c) => `<g:shipping><g:country>${esc(c)}</g:country><g:service>${esc(rate.name)}</g:service><g:price>${esc(price(rate.amount, f.market.currency))}</g:price></g:shipping>`).join("") : ""}
</item>`;
  res.type("application/xml").setHeader("Cache-Control", "public, max-age=900");
  res.send(`<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel><title>${esc(storeName())} (${esc(f.market.name)})</title><link>${esc(site())}</link><description>${esc(storeName())} products</description>\n${f.items.map(item).join("\n")}\n</channel></rss>`);
});

feedsRouter.get("/meta/:code.csv", async (req, res) => {
  const f = await rows(req.params.code);
  if (!f) return void res.status(404).send("not found");
  const head = ["id", "title", "description", "availability", "condition", "price", "sale_price", "link", "image_link", "additional_image_link", "brand", "item_group_id", "gtin", "mpn", "product_type", "size", "color", "quantity_to_sell_on_facebook"];
  const lines = f.items.map((i) => [i.id, i.title.slice(0, 200), i.desc, i.available.replace("_", " "), "new", i.price, i.sale, i.link, i.image, i.more.join(","), i.brand, i.group, i.gtin, i.mpn, i.type, i.size, i.color, i.qty].map(csvCell).join(","));
  res.type("text/csv; charset=utf-8").setHeader("Cache-Control", "public, max-age=900");
  res.send([head.join(","), ...lines].join("\n"));
});

export const feedLinks = async () => {
  const markets = await prisma.market.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  return markets.map((m) => ({ market: m.name, code: m.code, google: `${site()}/api/store/feeds/google/${m.code.toLowerCase()}.xml`, meta: `${site()}/api/store/feeds/meta/${m.code.toLowerCase()}.csv` }));
};
