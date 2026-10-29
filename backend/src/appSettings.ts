import { prisma, parseJson } from "./db.js";

// Typed JSON settings stored in the Setting table.
export type CheckoutSettings = { automaticTax: boolean; highValueMinor: number };
export type MarketingSettings = { abandonedEnabled: boolean; delayHours: number };
const DEFAULTS: { checkout: CheckoutSettings; marketing: MarketingSettings } = {
  checkout: { automaticTax: false, highValueMinor: 30000 },
  marketing: { abandonedEnabled: false, delayHours: 1 },
};
type Key = keyof typeof DEFAULTS;

export async function getSetting<K extends Key>(key: K): Promise<(typeof DEFAULTS)[K]> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return { ...DEFAULTS[key], ...parseJson<Record<string, unknown>>(row?.value ?? "{}", {}) } as (typeof DEFAULTS)[K];
}

export async function putSetting<K extends Key>(key: K, value: (typeof DEFAULTS)[K]) {
  await prisma.setting.upsert({ where: { key }, create: { key, value: JSON.stringify(value) }, update: { value: JSON.stringify(value) } });
}
