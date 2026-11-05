export type Cell = string | number | boolean | Date | null | undefined;

function cell(v: Cell): string {
  if (v == null) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  let s = v instanceof Date ? v.toISOString() : v;
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // neutralise spreadsheet formula injection
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** UTF-8 with BOM so Excel opens non-Latin names correctly. */
export const toCsv = (rows: Cell[][]) => '\uFEFF' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
