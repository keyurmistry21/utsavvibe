import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Default tax: UK 20% VAT (inclusive), US 0% (sales tax set per state later), CA 5% GST (exclusive). Edit in admin.
const markets = [
  { code: "UK", name: "United Kingdom", currency: "GBP", countries: ["GB"], taxRateBps: 2000, taxInclusive: true, ship: [{ name: "Royal Mail Tracked", amount: 495, freeOverAmount: 5000, minDays: 2, maxDays: 4 }] },
  { code: "US", name: "United States", currency: "USD", countries: ["US"], taxRateBps: 0, taxInclusive: false, ship: [{ name: "Standard", amount: 799, freeOverAmount: 7500, minDays: 4, maxDays: 8 }] },
  { code: "CA", name: "Canada", currency: "CAD", countries: ["CA"], taxRateBps: 500, taxInclusive: false, ship: [{ name: "Standard", amount: 999, freeOverAmount: 9900, minDays: 5, maxDays: 9 }] },
];

for (const { ship, countries, ...m } of markets) {
  const existing = await prisma.market.findUnique({ where: { code: m.code } });
  if (existing) continue;
  await prisma.market.create({ data: { ...m, countries: JSON.stringify(countries), shippingRates: { create: ship } } });
}
console.log("seeded markets");

// Canadian combined sales tax by province (GST/HST/PST/QST), in basis points. Verify with your accountant before relying on these.
// How each province's total splits (GST federal, PST provincial, HST combined, QST Quebec). Shown separately on receipts and the tax report.
const CA_PARTS: Record<string, { name: string; bps: number }[]> = {
  AB: [{ name: "GST", bps: 500 }], BC: [{ name: "GST", bps: 500 }, { name: "PST", bps: 700 }], MB: [{ name: "GST", bps: 500 }, { name: "PST", bps: 700 }],
  NB: [{ name: "HST", bps: 1500 }], NL: [{ name: "HST", bps: 1500 }], NS: [{ name: "HST", bps: 1400 }], NT: [{ name: "GST", bps: 500 }], NU: [{ name: "GST", bps: 500 }],
  ON: [{ name: "HST", bps: 1300 }], PE: [{ name: "HST", bps: 1500 }], QC: [{ name: "GST", bps: 500 }, { name: "QST", bps: 998 }], SK: [{ name: "GST", bps: 500 }, { name: "PST", bps: 600 }], YT: [{ name: "GST", bps: 500 }],
};
const caRegions: [string, string, number][] = [
  ["AB", "Alberta", 500], ["BC", "British Columbia", 1200], ["MB", "Manitoba", 1200], ["NB", "New Brunswick", 1500],
  ["NL", "Newfoundland and Labrador", 1500], ["NS", "Nova Scotia", 1400], ["NT", "Northwest Territories", 500],
  ["NU", "Nunavut", 500], ["ON", "Ontario", 1300], ["PE", "Prince Edward Island", 1500], ["QC", "Quebec", 1498],
  ["SK", "Saskatchewan", 1100], ["YT", "Yukon", 500],
];
const ca = await prisma.market.findUnique({ where: { code: "CA" } });
if (ca) {
  for (const [code, name, taxRateBps] of caRegions) {
    await prisma.marketRegion.upsert({ where: { marketId_code: { marketId: ca.id, code } }, create: { marketId: ca.id, code, name, taxRateBps, components: JSON.stringify(CA_PARTS[code] ?? []) }, update: { components: JSON.stringify(CA_PARTS[code] ?? []) } });
  }
  console.log("seeded CA provinces");
}
await prisma.$disconnect();
