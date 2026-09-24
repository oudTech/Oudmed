/** Same quoting convention as ReportsService.paymentsCsv - every field quoted, `"` doubled, CRLF rows. */
export function toCsv(rows: string[][]): string {
  return rows
    .map((cols) => cols.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\r\n');
}
