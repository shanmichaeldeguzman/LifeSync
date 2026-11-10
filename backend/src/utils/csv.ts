type Cell = string | number | null | undefined;

/** Minimal RFC 4180 CSV encoder with spreadsheet formula-injection protection. */
export function toCsv(headers: string[], rows: Cell[][]): string {
  const encode = (value: Cell): string => {
    if (value === null || value === undefined) return '';
    let s = String(value);
    // Neutralise values a spreadsheet would execute as formulas (CSV injection),
    // while leaving plain negative numbers intact.
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [headers, ...rows].map((r) => r.map(encode).join(',')).join('\r\n') + '\r\n';
}
