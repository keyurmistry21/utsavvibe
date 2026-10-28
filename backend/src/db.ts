import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

export const parseJson = <T>(s: string, fallback: T): T => {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

export async function nextOrderNumber(tx: Pick<PrismaClient, "counter">): Promise<number> {
  const c = await tx.counter.upsert({
    where: { name: "order" },
    create: { name: "order", value: 1001 },
    update: { value: { increment: 1 } },
  });
  return c.value;
}
