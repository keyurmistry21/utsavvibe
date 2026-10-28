import { Router } from "express";
import { z } from "zod";
import { prisma, parseJson } from "../db.js";
import { csvCell } from "../csv.js";

export const customersRouter = Router();

const address = z.object({
  country: z.string().max(2).default(""),
  firstName: z.string().default(""),
  lastName: z.string().default(""),
  company: z.string().default(""),
  line1: z.string().default(""),
  line2: z.string().default(""),
  city: z.string().default(""),
  region: z.string().default(""),
  postcode: z.string().default(""),
  phone: z.string().default(""),
});

const customerInput = z.object({
  firstName: z.string().trim().default(""),
  lastName: z.string().trim().default(""),
  email: z.union([z.string().trim().toLowerCase().email(), z.literal("")]).optional(),
  phone: z.string().trim().optional(),
  language: z.string().max(8).default("en"),
  acceptsEmail: z.boolean().default(false),
  acceptsSms: z.boolean().default(false),
  acceptsWhatsapp: z.boolean().default(false),
  taxExempt: z.boolean().default(false),
  address: address.nullable().optional(),
  tags: z.array(z.string()).default([]),
  notes: z.string().default(""),
});

const shape = (c: any) => ({ ...c, tags: parseJson<string[]>(c.tags, []), address: parseJson<Record<string, string> | null>(c.address ?? "null", null) });

const fullName = (d: { firstName: string; lastName: string }) => `${d.firstName} ${d.lastName}`.trim();

// marketing consent only makes sense when there is a way to reach the customer
const consent = (d: z.infer<typeof customerInput>) => ({
  acceptsEmail: !!d.email && d.acceptsEmail,
  acceptsSms: !!d.phone && d.acceptsSms,
  acceptsWhatsapp: !!d.phone && d.acceptsWhatsapp,
});

const regionName = new Intl.DisplayNames(["en"], { type: "region" });
const countryName = (c: string) => { try { return regionName.of(c) ?? c; } catch { return c; } };

const listQuery = z.object({
  q: z.string().trim().default(""),
  sort: z.enum(["updated", "created", "name", "orders"]).default("updated"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  filter: z.enum(["all", "subscribed", "unsubscribed", "with_orders", "no_orders", "tax_exempt"]).default("all"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

function listWhere(q: string, filter: z.infer<typeof listQuery>["filter"]) {
  const real = { orders: { some: { status: { not: "draft" } } } };
  return {
    ...(q ? { OR: [{ email: { contains: q } }, { name: { contains: q } }, { phone: { contains: q } }] } : {}),
    ...(filter === "subscribed" ? { acceptsEmail: true } : {}),
    ...(filter === "unsubscribed" ? { acceptsEmail: false } : {}),
    ...(filter === "with_orders" ? real : {}),
    ...(filter === "no_orders" ? { NOT: real } : {}),
    ...(filter === "tax_exempt" ? { taxExempt: true } : {}),
  };
}

// Paged customer table: one row per customer with everything the column picker can show.
async function customerRows(where: object, orderBy: object, limit?: number, offset?: number) {
  const customers = await prisma.customer.findMany({
    where,
    orderBy,
    take: limit,
    skip: offset,
    include: { orders: { orderBy: { createdAt: "desc" }, take: 1, select: { shippingAddress: true } } },
  });
  const ids = customers.map((c) => c.id);
  const [counts, spent] = await Promise.all([
    prisma.order.groupBy({ by: ["customerId"], where: { customerId: { in: ids }, status: { not: "draft" } }, _count: { _all: true } }),
    prisma.order.groupBy({ by: ["customerId", "currency"], where: { customerId: { in: ids }, paymentStatus: "paid" }, _sum: { total: true } }),
  ]);
  return customers.map(({ orders, ...c }) => {
    const def = parseJson<Record<string, string> | null>(c.address ?? "null", null);
    const last = parseJson<Record<string, string>>(orders[0]?.shippingAddress ?? "{}", {});
    const a = def ?? (last.line1 || last.city ? last : null);
    const place = a ? [[a.city, a.region].filter(Boolean).join(" "), a.country ? countryName(a.country) : ""].filter(Boolean).join(", ") : "";
    const [firstName, ...rest] = c.name.split(" ");
    return {
      ...shape(c),
      firstName: firstName ?? "",
      lastName: rest.join(" "),
      location: place,
      postcode: a?.postcode ?? "",
      orderCount: counts.find((x) => x.customerId === c.id)?._count._all ?? 0,
      // spend per currency; currencies are never summed together
      spent: Object.fromEntries(spent.filter((x) => x.customerId === c.id).map((x) => [x.currency, x._sum.total ?? 0])),
    };
  });
}

const orderByFor = (sort: z.infer<typeof listQuery>["sort"], dir: "asc" | "desc") =>
  sort === "name" ? [{ name: dir }, { id: dir }] : sort === "created" ? [{ createdAt: dir }, { id: dir }] : sort === "orders" ? [{ orders: { _count: dir } }, { id: dir }] : [{ updatedAt: dir }, { id: dir }];

customersRouter.get("/", async (req, res) => {
  const { q, sort, dir, filter, limit, offset } = listQuery.parse(req.query);
  const where = listWhere(q, filter);
  const [items, total] = await Promise.all([customerRows(where, orderByFor(sort, dir), limit, offset), prisma.customer.count({ where })]);
  res.json({ items, total });
});

// ---- CSV export / import ----
customersRouter.get("/export", async (req, res) => {
  const ids = String(req.query.ids ?? "").split(",").filter(Boolean);
  const q = String(req.query.q ?? "").trim();
  const filter = listQuery.shape.filter.parse(req.query.filter ?? "all");
  const rows = await customerRows(ids.length ? { id: { in: ids } } : listWhere(q, filter), [{ createdAt: "asc" }], 10000, 0);
  const header = ["First Name", "Last Name", "Email", "Phone", "Language", "Accepts Email Marketing", "Accepts SMS Marketing", "Accepts WhatsApp Marketing", "Tax Exempt", "Company", "Address1", "Address2", "City", "Province Code", "Country Code", "Zip", "Tags", "Note", "Total Orders", "Total Spent", "Created At"];
  const lines = rows.map((c) => {
    const a = (c.address ?? {}) as Record<string, string>;
    return [c.firstName, c.lastName, c.email, c.phone, c.language, c.acceptsEmail ? "yes" : "no", c.acceptsSms ? "yes" : "no", c.acceptsWhatsapp ? "yes" : "no", c.taxExempt ? "yes" : "no", a.company, a.line1, a.line2, a.city, a.region, a.country, a.postcode, c.tags.join(", "), c.notes, c.orderCount, Object.entries(c.spent as Record<string, number>).map(([cur, v]) => `${(v / 100).toFixed(2)} ${cur}`).join(" + "), c.createdAt.toISOString()].map(csvCell).join(",");
  });
  res.setHeader("content-type", "text/csv; charset=utf-8");
  res.setHeader("content-disposition", `attachment; filename="customers-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send([header.map(csvCell).join(","), ...lines].join("\r\n"));
});

const importRow = z.object({
  firstName: z.string().trim().max(100).default(""),
  lastName: z.string().trim().max(100).default(""),
  email: z.string().trim().toLowerCase().max(190).default(""),
  phone: z.string().trim().max(40).default(""),
  language: z.string().trim().max(8).default(""),
  acceptsEmail: z.boolean().default(false),
  acceptsSms: z.boolean().default(false),
  acceptsWhatsapp: z.boolean().default(false),
  taxExempt: z.boolean().default(false),
  company: z.string().max(190).default(""),
  line1: z.string().max(190).default(""),
  line2: z.string().max(190).default(""),
  city: z.string().max(120).default(""),
  region: z.string().max(40).default(""),
  country: z.string().max(2).default(""),
  postcode: z.string().max(20).default(""),
  tags: z.array(z.string().max(60)).max(30).default([]),
  notes: z.string().max(5000).default(""),
});

customersRouter.post("/import", async (req, res) => {
  const { rows } = z.object({ rows: z.array(z.unknown()).min(1).max(1000) }).parse(req.body);
  let created = 0, updated = 0;
  const errors: { row: number; error: string }[] = [];
  for (const [i, raw] of rows.entries()) {
    const n = i + 1;
    const p = importRow.safeParse(raw);
    if (!p.success) { errors.push({ row: n, error: p.error.issues[0]?.message ?? "invalid row" }); continue; }
    const d = p.data;
    if (d.email && !z.string().email().safeParse(d.email).success) { errors.push({ row: n, error: `invalid email "${d.email.slice(0, 40)}"` }); continue; }
    if (!d.email && !d.phone) { errors.push({ row: n, error: "needs an email or a phone number" }); continue; }
    const addr = d.line1 || d.city || d.postcode ? { country: d.country, firstName: d.firstName, lastName: d.lastName, company: d.company, line1: d.line1, line2: d.line2, city: d.city, region: d.region, postcode: d.postcode, phone: d.phone } : null;
    const name = `${d.firstName} ${d.lastName}`.trim();
    try {
      const existing = d.email ? await prisma.customer.findUnique({ where: { email: d.email } }) : await prisma.customer.findFirst({ where: { phone: d.phone, email: null } });
      if (existing) {
        const mergedTags = Array.from(new Set([...parseJson<string[]>(existing.tags, []), ...d.tags]));
        await prisma.customer.update({
          where: { id: existing.id },
          data: {
            ...(name ? { name } : {}), ...(d.phone ? { phone: d.phone } : {}), ...(d.language ? { language: d.language } : {}),
            ...(d.acceptsEmail ? { acceptsEmail: true } : {}), ...(d.acceptsSms ? { acceptsSms: true } : {}), ...(d.acceptsWhatsapp ? { acceptsWhatsapp: true } : {}),
            ...(d.taxExempt ? { taxExempt: true } : {}), ...(addr ? { address: JSON.stringify(addr) } : {}), tags: JSON.stringify(mergedTags), ...(d.notes ? { notes: d.notes } : {}),
          },
        });
        updated++;
      } else {
        await prisma.customer.create({
          data: {
            email: d.email || null, phone: d.phone || null, name, language: d.language || "en",
            acceptsEmail: !!d.email && d.acceptsEmail, acceptsSms: !!d.phone && d.acceptsSms, acceptsWhatsapp: !!d.phone && d.acceptsWhatsapp,
            taxExempt: d.taxExempt, address: addr ? JSON.stringify(addr) : null, tags: JSON.stringify(d.tags), notes: d.notes,
          },
        });
        created++;
      }
    } catch (e) {
      errors.push({ row: n, error: (e as Error).message.slice(0, 120) });
    }
  }
  res.json({ created, updated, skipped: errors.length, errors: errors.slice(0, 50) });
});

// Typeahead / full list for the draft order page (paged). Address = saved default, else the last one they ordered to.
customersRouter.get("/search", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  const limit = Math.min(Number(req.query.limit) || 30, 100);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const customers = await prisma.customer.findMany({
    where: q ? { OR: [{ email: { contains: q } }, { name: { contains: q } }, { phone: { contains: q } }] } : {},
    include: { orders: { orderBy: { createdAt: "desc" }, take: 1, select: { shippingAddress: true } } },
    orderBy: [{ name: "asc" }, { email: "asc" }, { id: "asc" }],
    take: limit,
    skip: offset,
  });
  res.json(
    customers.map((c) => {
      const last = parseJson<Record<string, string>>(c.orders[0]?.shippingAddress ?? "{}", {});
      const def = parseJson<Record<string, string> | null>(c.address ?? "null", null);
      return { id: c.id, name: c.name, email: c.email, phone: c.phone, taxExempt: c.taxExempt, address: def ?? (last.line1 ? last : null) };
    }),
  );
});

customersRouter.post("/", async (req, res) => {
  const d = customerInput.parse(req.body);
  const email = d.email || null;
  const phone = d.phone || null;
  if (!email && !phone) return void res.status(400).json({ error: "Add an email address or a phone number" });
  if (email && (await prisma.customer.findUnique({ where: { email } }))) return void res.status(409).json({ error: "A customer with this email already exists" });
  const c = await prisma.customer.create({
    data: {
      email,
      phone,
      name: fullName(d),
      language: d.language,
      ...consent({ ...d, email: email ?? "", phone: phone ?? "" }),
      taxExempt: d.taxExempt,
      address: d.address ? JSON.stringify(d.address) : null,
      tags: JSON.stringify(d.tags),
      notes: d.notes,
    },
  });
  res.status(201).json(shape(c));
});

customersRouter.get("/:id", async (req, res) => {
  const c = await prisma.customer.findUnique({ where: { id: req.params.id }, include: { orders: { orderBy: { createdAt: "desc" } } } });
  if (!c) return void res.status(404).json({ error: "not found" });
  res.json(shape(c));
});

customersRouter.patch("/:id", async (req, res) => {
  const d = customerInput.partial().parse(req.body);
  const data: Record<string, unknown> = {};
  if (d.firstName !== undefined || d.lastName !== undefined) data.name = fullName({ firstName: d.firstName ?? "", lastName: d.lastName ?? "" });
  if (d.phone !== undefined) data.phone = d.phone || null;
  if (d.language !== undefined) data.language = d.language;
  if (d.acceptsEmail !== undefined) data.acceptsEmail = d.acceptsEmail;
  if (d.acceptsSms !== undefined) data.acceptsSms = d.acceptsSms;
  if (d.acceptsWhatsapp !== undefined) data.acceptsWhatsapp = d.acceptsWhatsapp;
  if (d.taxExempt !== undefined) data.taxExempt = d.taxExempt;
  if (d.address !== undefined) data.address = d.address ? JSON.stringify(d.address) : null;
  if (d.tags !== undefined) data.tags = JSON.stringify(d.tags);
  if (d.notes !== undefined) data.notes = d.notes;
  const c = await prisma.customer.update({ where: { id: req.params.id }, data });
  res.json(shape(c));
});
