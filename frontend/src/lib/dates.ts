// Local calendar-day helpers for date range pickers (values are YYYY-MM-DD strings).
export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const monthsAgo = (n: number) => { const d = new Date(); d.setMonth(d.getMonth() - n); return ymd(d); };
export const today = () => ymd(new Date());
export const PRESETS = [
  { key: "1m", label: "1 month", from: () => monthsAgo(1) },
  { key: "3m", label: "3 months", from: () => monthsAgo(3) },
  { key: "6m", label: "6 months", from: () => monthsAgo(6) },
  { key: "1y", label: "1 year", from: () => monthsAgo(12) },
  { key: "ytd", label: "This year", from: () => `${new Date().getFullYear()}-01-01` },
] as const;
export type PresetKey = (typeof PRESETS)[number]["key"] | "custom";
