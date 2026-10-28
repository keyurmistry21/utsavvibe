// CSV cell: always quoted; cells starting with = + - @ (or tab/CR) get a leading ' so spreadsheets never run them as formulas.
export const csvCell = (v: unknown) => {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};
