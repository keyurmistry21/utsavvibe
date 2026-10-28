// Small field validators. Each returns an error message, or "" when the value is fine. Empty optional values are fine.
export const required = (v: string, msg = "This field is required") => (v.trim() ? "" : msg);
export const maxLen = (v: string, n: number, what = "This field") => (v.length > n ? `${what} is too long (max ${n} characters)` : "");

export const email = (v: string, isRequired = false) => {
  const t = v.trim();
  if (!t) return isRequired ? "Enter an email address" : "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(t) ? "" : "Enter a valid email address, like name@example.com";
};

// Phone values are stored as "+1 416 555 0123" (country code + number): 8 to 15 digits in total.
export const phone = (v: string) => {
  const t = v.trim();
  if (!t) return "";
  const digits = t.replace(/\D/g, "");
  if (/[^\d\s()+\-.]/.test(t)) return "Phone numbers can only contain digits, spaces, + ( ) - .";
  return digits.length >= 8 && digits.length <= 15 ? "" : "Enter a valid phone number (8 to 15 digits including the country code)";
};

export const money = (v: string, opts: { required?: boolean; label?: string; max?: number } = {}) => {
  const { required: req = true, label = "price", max = 9_999_999.99 } = opts;
  const t = v.trim();
  if (!t) return req ? `Enter a ${label}` : "";
  const n = Number(t);
  if (!Number.isFinite(n)) return "Enter a number, like 19.99";
  if (n < 0) return `The ${label} can't be negative`;
  if (n > max) return `The ${label} is too large`;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return "Use at most 2 decimal places";
  return "";
};

export const int = (v: string, min: number, max: number, label = "quantity", isRequired = true) => {
  const t = v.trim();
  if (!t) return isRequired ? `Enter a ${label}` : "";
  if (!/^-?\d+$/.test(t)) return "Enter a whole number";
  const n = Number(t);
  if (n < min) return `The ${label} must be at least ${min}`;
  if (n > max) return `The ${label} can't be more than ${max.toLocaleString()}`;
  return "";
};

export const decimal = (v: string, max: number, label = "value") => {
  const t = v.trim();
  if (!t) return "";
  const n = Number(t);
  if (!Number.isFinite(n)) return "Enter a number";
  if (n < 0) return `The ${label} can't be negative`;
  if (n > max) return `The ${label} is too large`;
  return "";
};

const POSTCODE: Record<string, [RegExp, string]> = {
  CA: [/^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z][ -]?\d[ABCEGHJ-NPRSTV-Z]\d$/i, "Enter a Canadian postal code, like M5V 2T6"],
  US: [/^\d{5}(-\d{4})?$/, "Enter a US ZIP code, like 94105 or 94105-1234"],
  GB: [/^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i, "Enter a UK postcode, like SW1A 1AA"],
};
export const postcode = (v: string, country: string, isRequired = true) => {
  const t = v.trim();
  if (!t) return isRequired ? "Enter a postal code" : "";
  const rule = POSTCODE[country];
  if (rule && !rule[0].test(t)) return rule[1];
  return t.length > 12 ? "That postal code is too long" : "";
};

export const hasErrors = (e: Record<string, string | undefined>) => Object.values(e).some(Boolean);
