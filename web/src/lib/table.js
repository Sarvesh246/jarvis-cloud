/* Tables arrive as Markdown, but once rendered they are data: they can be
   sorted, copied into a spreadsheet, saved as CSV or drawn as a chart. */

export function cellText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

/* "1,234.5", "$12", "-3%", "4.2k" -> number; anything else -> NaN */
export function toNumber(value) {
  const text = cellText(value).replace(/[,\s]/g, "");
  const match = text.match(/^[-+−]?[$€£¥₹]?[-+−]?(\d+(\.\d+)?|\.\d+)([kmb%])?$/i);
  if (!match) return NaN;
  const negative = /^[-−]|^[$€£¥₹][-−]/.test(text);
  let n = parseFloat(match[1]);
  const suffix = (match[3] || "").toLowerCase();
  if (suffix === "k") n *= 1e3;
  if (suffix === "m") n *= 1e6;
  if (suffix === "b") n *= 1e9;
  return negative ? -n : n;
}

export function isNumericColumn(rows, column) {
  const values = rows.map((row) => cellText(row[column])).filter(Boolean);
  return values.length > 0 && values.every((value) => !Number.isNaN(toNumber(value)));
}

export function sortRows(rows, column, direction = "asc") {
  if (column == null) return rows;
  const numeric = isNumericColumn(rows, column);
  const sign = direction === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const x = numeric ? toNumber(a[column]) : cellText(a[column]).toLowerCase();
    const y = numeric ? toNumber(b[column]) : cellText(b[column]).toLowerCase();
    // Blank cells in a numeric column go last either way, so the order stays consistent.
    if (numeric && (Number.isNaN(x) || Number.isNaN(y)))
      return Number.isNaN(x) - Number.isNaN(y);
    if (x < y) return -1 * sign;
    if (x > y) return 1 * sign;
    return 0;
  });
}

function csvCell(value) {
  let text = cellText(value);
  // A spreadsheet would run "=…", "+…", "-…" or "@…" as a formula.
  if (/^[=+\-@]/.test(text) && Number.isNaN(toNumber(text))) text = `'${text}`;
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCSV(columns, rows) {
  return [columns, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

export function toTSV(columns, rows) {
  return [columns, ...rows]
    .map((row) => row.map((cell) => cellText(cell).replace(/\t/g, " ")).join("\t"))
    .join("\n");
}

/* A chart is offered only when it would actually say something: one label
   column and at least one numeric column, with a handful of rows. */
export function chartable(columns, rows) {
  if (rows.length < 2 || rows.length > 40 || columns.length < 2) return null;
  const numeric = columns.map((_, i) => i).filter((i) => isNumericColumn(rows, i));
  const label = columns.findIndex((_, i) => !numeric.includes(i));
  if (!numeric.length) return null;
  return { label: label >= 0 ? label : null, values: numeric };
}
