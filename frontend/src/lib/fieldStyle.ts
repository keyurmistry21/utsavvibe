export const FIELD_STYLES = [
  { id: "classic", label: "Current", note: "Medium-gray border that darkens on hover, blue ring on focus." },
  { id: "light", label: "Light border", note: "Very light border, a bit darker on hover, soft blue ring on focus." },
  { id: "filled", label: "Filled, no border", note: "Soft gray fill with no border; turns white with a ring on focus." },
  { id: "underline", label: "Underline", note: "Only a line underneath; a blue line grows from the centre on focus." },
  { id: "glow", label: "Glow", note: "Faint border; hover lifts it with a shadow, focus glows blue." },
] as const;
export type FieldStyleId = (typeof FIELD_STYLES)[number]["id"];

const KEY = "fieldStyle";
export const getFieldStyle = (): FieldStyleId => {
  try { const v = localStorage.getItem(KEY); return (FIELD_STYLES.some((s) => s.id === v) ? v : "classic") as FieldStyleId; } catch { return "classic"; }
};
export const setFieldStyle = (id: FieldStyleId) => {
  document.documentElement.setAttribute("data-fields", id);
  try { localStorage.setItem(KEY, id); } catch {}
};
