import { PrismaClient } from "@prisma/client";

// Demo catalog so the storefront isn't empty. Products are tagged "demo" (handles are plain, no prefix).
// usage: npm -w backend run seed:demo [-- --clear]
const prisma = new PrismaClient();

// prices in minor units per market code: [GBP, USD, CAD]
type P = { GB: number; US: number; CA: number };
const catalog: { title: string; description: string; tags: string[]; variants: { title: string; options: Record<string, string>; stock: number; price: P }[] }[] = [
  {
    title: "Brass Ganesha Idol",
    description: "Hand-finished brass Ganesha, ideal for home mandirs and festive gifting. Packed in a padded gift box.",
    tags: ["ganesha", "idol", "brass"],
    variants: [
      { title: "6 inch", options: { Size: "6 inch" }, stock: 20, price: { GB: 2499, US: 3199, CA: 4299 } },
      { title: "9 inch", options: { Size: "9 inch" }, stock: 12, price: { GB: 3999, US: 4999, CA: 6799 } },
      { title: "12 inch", options: { Size: "12 inch" }, stock: 6, price: { GB: 6499, US: 8199, CA: 10999 } },
    ],
  },
  {
    title: "Handcrafted Diwali Diya Set (6)",
    description: "Six hand-painted clay diyas with gold detailing. Burn clean and look beautiful on any aarti thali.",
    tags: ["diwali", "diya", "decor"],
    variants: [{ title: "Set of 6", options: {}, stock: 40, price: { GB: 1299, US: 1599, CA: 2199 } }],
  },
  {
    title: "Designer Rakhi — Peacock",
    description: "Beaded peacock rakhi with a soft thread, presented in a keepsake box with roli chawal.",
    tags: ["rakhi", "gift"],
    variants: [
      { title: "Single", options: { Pack: "Single" }, stock: 50, price: { GB: 599, US: 799, CA: 1099 } },
      { title: "Set of 3", options: { Pack: "Set of 3" }, stock: 30, price: { GB: 1499, US: 1899, CA: 2599 } },
    ],
  },
  {
    title: "Silver-Plated Pooja Thali Set",
    description: "Complete pooja thali with kalash, diya, bell, incense holder and katori. Tarnish-resistant finish.",
    tags: ["pooja", "silver", "thali"],
    variants: [{ title: "Default", options: {}, stock: 15, price: { GB: 3499, US: 4399, CA: 5899 } }],
  },
  {
    title: "Lakshmi Ganesh Wall Hanging",
    description: "Embroidered torana-style wall hanging with Lakshmi and Ganesh motifs. Perfect for doorways at Diwali.",
    tags: ["diwali", "decor", "wall-hanging"],
    variants: [{ title: "Default", options: {}, stock: 25, price: { GB: 1899, US: 2399, CA: 3199 } }],
  },
  {
    title: "Premium Incense & Dhoop Gift Box",
    description: "Sandalwood, rose and jasmine agarbatti with a wooden holder, boxed for gifting.",
    tags: ["incense", "gift", "pooja"],
    variants: [{ title: "Default", options: {}, stock: 35, price: { GB: 1599, US: 1999, CA: 2699 } }],
  },
];

const slug = (s: string) => `${s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;

if (process.argv.includes("--clear")) {
  const r = await prisma.product.deleteMany({ where: { tags: { contains: JSON.stringify("demo") }, notes: { startsWith: "Demo product." }, variants: { none: { orderItems: { some: {} } } } } });
  console.log(`removed ${r.count} demo products`);
} else {
  const markets = await prisma.market.findMany();
  const byCountry: Record<string, string> = { GB: "UK", US: "US", CA: "CA" };
  for (const p of catalog) {
    const handle = slug(p.title);
    if (await prisma.product.findUnique({ where: { handle } })) continue;
    await prisma.product.create({
      data: {
        title: p.title,
        handle,
        description: p.description,
        status: "active",
        tags: JSON.stringify([...p.tags, "demo"]),
        notes: "Demo product. Remove with: npm run seed:demo -- --clear",
        markets: { create: markets.map((m) => ({ marketId: m.id })) },
        variants: {
          create: p.variants.map((v) => ({
            title: v.title,
            options: JSON.stringify(v.options),
            inventory: v.stock,
            prices: {
              create: markets.map((m) => {
                const key = Object.keys(byCountry).find((k) => byCountry[k] === m.code) as keyof P;
                return { marketId: m.id, amount: v.price[key] };
              }),
            },
          })),
        },
      },
    });
  }
  console.log(`demo catalog ready (${catalog.length} products x ${markets.length} markets)`);
}
await prisma.$disconnect();
