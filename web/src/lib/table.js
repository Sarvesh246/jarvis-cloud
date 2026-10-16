/* Tables arrive as Markdown, but once rendered they are data: they can be
   sorted, copied into a spreadsheet, saved as CSV or drawn as a chart. */

export function cellText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

/* Cells that say "nothing here" in words. They sort with the blanks and
   don't stop a column of figures or dates from counting as one. */
const PLACEHOLDER = /^(?:[-–—−?]+|n\/?a|tb[ad]|none|unknown)$/i;

export function isBlank(value) {
  const text = cellText(value);
  return !text || PLACEHOLDER.test(text);
}

/* "1,234.5", "$12", "-3%", "4.2k", "(1,200)", "~40" -> number; anything else -> NaN */
export function toNumber(value) {
  let text = cellText(value).replace(/[,\s]/g, "").replace(/^[~≈]/, "");
  // Accounting style: "(1,200)" and "$(50)" are negative.
  const bracketed = text.match(/^([$€£¥₹]?)\(([^()]+)\)$/);
  if (bracketed) {
    if (/^[-+−]/.test(bracketed[2])) return NaN;
    const n = toNumber(bracketed[1] + bracketed[2]);
    return n === 0 ? 0 : -n;
  }
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

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
const WEEKDAY = "(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\\.?,?\\s+)?";
const ISO_DATE = /^(\d{4})[-/](\d{1,2})(?:[-/](\d{1,2}))?(?:[T\s]+(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?\s*(?:z|utc|[+-]\d{2}:?\d{2})?)?$/i;
const MONTH_FIRST = new RegExp(`^${WEEKDAY}${MONTH}\\s+(?:(\\d{1,2})(?:st|nd|rd|th)?,?\\s+)?(\\d{4})$`, "i");
const DAY_FIRST = new RegExp(`^${WEEKDAY}(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH},?\\s+(\\d{4})$`, "i");
const QUARTER = /^(?:q([1-4])\s*(\d{4})|(\d{4})\s*q([1-4]))$/i;

function dateAt(year, month, day = 1, hour = 0, minute = 0) {
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return NaN;
  return Date.UTC(year, month - 1, day, hour, minute);
}

const monthNumber = (name) => MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1;

/* Dates written the ways replies write them: "2024-03-05", "Mar 5, 2024",
   "5 March 2024", "March 2024", "Q3 2024". Day/month order in "03/05/2024"
   is a guess, so those stay text. Returns a timestamp or NaN. */
export function toDate(value) {
  const text = cellText(value);
  let match = text.match(ISO_DATE);
  if (match)
    return dateAt(+match[1], +match[2], match[3] ? +match[3] : 1, +(match[4] || 0), +(match[5] || 0));
  if ((match = text.match(MONTH_FIRST))) return dateAt(+match[3], monthNumber(match[1]), match[2] ? +match[2] : 1);
  if ((match = text.match(DAY_FIRST))) return dateAt(+match[3], monthNumber(match[2]), +match[1]);
  if ((match = text.match(QUARTER))) {
    const [quarter, year] = match[1] ? [+match[1], +match[2]] : [+match[4], +match[3]];
    return dateAt(year, quarter * 3 - 2);
  }
  return NaN;
}

function filled(rows, column) {
  return rows.map((row) => row[column]).filter((value) => !isBlank(value));
}

export function isNumericColumn(rows, column) {
  const values = filled(rows, column);
  return values.length > 0 && values.every((value) => !Number.isNaN(toNumber(value)));
}

export function isDateColumn(rows, column) {
  const values = filled(rows, column);
  return (
    values.length > 0 &&
    !isNumericColumn(rows, column) &&
    values.every((value) => !Number.isNaN(toDate(value)))
  );
}

/* "Item 2" before "Item 10", and "Émile" beside "Emile". */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function sortRows(rows, column, direction = "asc") {
  if (column == null) return rows;
  const kind = isNumericColumn(rows, column) ? "number" : isDateColumn(rows, column) ? "date" : "text";
  const sign = direction === "desc" ? -1 : 1;
  const key = (row) => {
    if (isBlank(row[column])) return null;
    if (kind === "number") return toNumber(row[column]);
    if (kind === "date") return toDate(row[column]);
    return cellText(row[column]);
  };
  return rows
    .map((row) => [key(row), row])
    .sort(([x], [y]) => {
      // Blank cells go last either way, so the order stays consistent.
      if (x == null || y == null) return (x == null) - (y == null);
      if (kind === "text") return collator.compare(x, y) * sign;
      return (x - y) * sign;
    })
    .map(([, row]) => row);
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

/* Years are figures, but charting them says nothing: a "Year" column, or one
   holding only years, names the rows instead. */
function isYearColumn(columns, rows, column) {
  if (/^(?:year|yr|fy|season)\b/i.test(cellText(columns[column]))) return true;
  const values = filled(rows, column).map(cellText);
  return values.length > 0 && values.every((value) => /^(1[89]|2[01])\d\d$/.test(value));
}

/* A chart is offered only when it would actually say something: one label
   column and at least one numeric column, with a handful of rows. */
export function chartable(columns, rows) {
  if (rows.length < 2 || rows.length > 40 || columns.length < 2) return null;
  const numeric = columns.map((_, i) => i).filter((i) => isNumericColumn(rows, i));
  const years = numeric.filter((i) => isYearColumn(columns, rows, i));
  const values = numeric.filter((i) => !years.includes(i));
  if (!values.length) return null;
  const label = columns.findIndex((_, i) => !numeric.includes(i));
  return { label: label >= 0 ? label : years.length ? years[0] : null, values };
}
