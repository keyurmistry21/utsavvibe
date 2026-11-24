import { Router } from "express";
import { z } from "zod";
import { prisma, parseJson } from "../db.js";

export const marketsRouter = Router();

const marketInput = z.object({
  code: z.string().min(2).max(8),
  name: z.string().min(1),
  currency: z.string().length(3),
  countries: z.array(z.string().length(2)),
  taxRateBps: z.number().int().min(0).max(10000),
  taxInclusive: z.boolean().default(false),
  active: z.boolean().default(true),
  regions: z.array(z.object({ code: z.string().min(1).max(8).transform((c) => c.toUpperCase()), name: z.string().min(1), taxRateBps: z.number().int().min(0).max(10000), components: z.array(z.object({ name: z.string().trim().min(1).max(10), bps: z.number().int().min(1).max(10000) })).max(4).nullable().optional() }).refine((r) => !r.components?.length || r.components.reduce((a, c) => a + c.bps, 0) === r.taxRateBps, "The parts must add up to the total tax rate")).default([]),
  shippingRates: z
    .array(
      z.object({
        name: z.string().min(1),
        amount: z.number().int().min(0),
        freeOverAmount: z.number().int().min(0).nullable().optional(),
        minDays: z.number().int().nullable().optional(),
        maxDays: z.number().int().nullable().optional(),
      }),
    )
    .default([]),
});

const shape = (m: any) => ({ ...m, countries: parseJson<string[]>(m.countries, []), regions: (m.regions ?? []).map((r: any) => ({ ...r, components: parseJson<{ name: string; bps: number }[] | null>(r.components ?? "null", null) })) });
const encodeRegion = (r: { code: string; name: string; taxRateBps: number; components?: { name: string; bps: number }[] | null }) => ({ code: r.code, name: r.name, taxRateBps: r.taxRateBps, components: r.components?.length ? JSON.stringify(r.components) : null });

marketsRouter.get("/", async (_req, res) => {
  const markets = await prisma.market.findMany({ include: { shippingRates: true, regions: { orderBy: { name: "asc" } } }, orderBy: { name: "asc" } });
  res.json(markets.map(shape));
});

marketsRouter.post("/", async (req, res) => {
  const d = marketInput.parse(req.body);
  const { shippingRates, regions, countries, ...rest } = d;
  const m = await prisma.market.create({
    data: { ...rest, countries: JSON.stringify(countries), shippingRates: { create: shippingRates }, regions: { create: regions.map(encodeRegion) } },
    include: { shippingRates: true, regions: { orderBy: { name: "asc" } } },
  });
  res.status(201).json(shape(m));
});

marketsRouter.put("/:id", async (req, res) => {
  const d = marketInput.parse(req.body);
  const { shippingRates, regions, countries, ...rest } = d;
  const m = await prisma.$transaction(async (tx) => {
    await tx.shippingRate.deleteMany({ where: { marketId: req.params.id } });
    await tx.marketRegion.deleteMany({ where: { marketId: req.params.id } });
    return tx.market.update({
      where: { id: req.params.id },
      data: { ...rest, countries: JSON.stringify(countries), shippingRates: { create: shippingRates }, regions: { create: regions.map(encodeRegion) } },
      include: { shippingRates: true, regions: { orderBy: { name: "asc" } } },
    });
  });
  res.json(shape(m));
});
