export const dialCodes = [
  { code: "CA", name: "Canada", dial: "+1" },
  { code: "US", name: "United States", dial: "+1" },
  { code: "GB", name: "United Kingdom", dial: "+44" },
  { code: "IN", name: "India", dial: "+91" },
  { code: "AU", name: "Australia", dial: "+61" },
  { code: "AE", name: "United Arab Emirates", dial: "+971" },
] as const;

export const countryName = (c: string) => {
  try { return new Intl.DisplayNames(["en"], { type: "region" }).of(c) ?? c; } catch { return c; }
};

// "+1 4165550199" -> { code: "CA", number: "4165550199" }. Unknown prefixes keep the whole string as the number.
export function splitPhone(value: string, fallback = "CA") {
  const v = value.trim();
  const hit = [...dialCodes].sort((a, b) => b.dial.length - a.dial.length).find((d) => v.startsWith(d.dial + " ") || v.startsWith(d.dial) && /^\+\d+\s/.test(v));
  if (hit) return { code: dialCodes.find((d) => d.dial === hit.dial && d.code === fallback)?.code ?? hit.code, number: v.slice(hit.dial.length).trim() };
  return { code: fallback, number: v.replace(/^\+/, "") };
}
export const joinPhone = (code: string, number: string) => (number.trim() ? `${dialCodes.find((d) => d.code === code)?.dial ?? "+1"} ${number.trim()}` : "");
