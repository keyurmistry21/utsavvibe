import type { Request } from "express";
import { prisma } from "./db.js";

type U = { id: string; email: string } | null | undefined;

/** Security-relevant events only. Never put passwords, tokens or card data in `detail`. */
export async function audit(req: Request, action: string, detail = "", user?: U) {
  const u = user ?? (req as Request & { user?: U }).user;
  await prisma.auditLog
    .create({ data: { userId: u?.id?.startsWith("key:") ? null : (u?.id ?? null), userEmail: u?.email ?? "", action, detail: detail.slice(0, 500), ip: (req.ip ?? "").slice(0, 64) } })
    .catch((e) => console.error("audit failed:", (e as Error).message));
}
