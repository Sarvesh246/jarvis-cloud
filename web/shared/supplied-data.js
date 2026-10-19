// Figures a person typed into their own request. Charts and figure cards are
// drawn from these when a model answers in prose, so the visual never depends
// on the reply's shape. Nothing here is invented: every number is quoted.
const NUMBER = String.raw`[-+−]?[$€£¥₹]?[-+−]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:%|[kKmMbB]\b)?`;
const VALUE = new RegExp(`^${NUMBER}$`);
const MONTHS =
  /^(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)$/i;
const QUARTER = /^q[1-4]$/i;
const NOISE =
  /^(?:and|or|then|but|with|plus|from|to|of|the|a|an|is|was|are|were|at|in|on|by|for|about|roughly|around|approximately|total|totals)$/i;
const LEAD =
  /^(?:how|what|why|which|who|help|explain|show|give|break|tell|walk|let|please|can|could|would|should|compare|chart|graph|plot)$/i;

// "November 1" is a date, not the figure 1 for something called November.
const DAY_OF_MONTH = (label, cell) =>
  MONTHS.test(label.split(" ").at(-1)) && /^\d{1,2}$/.test(cell);
const unitOf = (text) =>
  `${text.match(/[$€£¥₹]/)?.[0] || ""}${/%$/.test(text) ? "%" : ""}`;

function labelFrom(raw) {
  let words = raw
    .replace(/[“”"()]/g, " ")
    .split(/[\s]+/)
    .filter(Boolean);
  // Keep the trailing run of words that name the item; drop leading filler.
  while (words.length && NOISE.test(words[0])) words.shift();
  while (words.length && NOISE.test(words.at(-1))) words.pop();
  if (words.length > 4) words = words.slice(-3);
  return words.join(" ").replace(/[:=—–-]+$/, "").trim();
}

// "North 18%, South −12%" or "January: $18,000 and $8,000. February: ..."
// -> { labels, rows: [[v, ...], ...] } with every row the same width and unit.
export function suppliedSeries(text = "") {
  if (typeof text !== "string" || text.length > 4000) return null;
  const flat = text.replace(/\s+/g, " ");
  const pattern = new RegExp(
    `([^\\d$€£¥₹%;,.:?!]*?)\\s*:?\\s*(${NUMBER}(?:\\s*(?:and|&|\\/)\\s*${NUMBER})*)(?=\\s*(?:[,;.:?!]|\\band\\b|$))`,
    "g",
  );
  const rows = [];
  let last = 0;
  for (const m of flat.matchAll(pattern)) {
    if (m.index < last) continue;
    // A number followed by a word is a quantity ("12 hours"), not a series.
    const tail = flat.slice(m.index + m[0].length).match(/^\s*([A-Za-z]+)/);
    const label = labelFrom(m[1]);
    const cells = m[2].split(/\s*(?:and|&|\/)\s*/).map((x) => x.trim());
    last = m.index + m[0].length;
    if (!label || !cells.every((c) => VALUE.test(c))) continue;
    if (DAY_OF_MONTH(label, cells[0])) return null;
    if (tail && !NOISE.test(tail[1]) && !/^[A-Z]/.test(tail[1]) && !/^(?:and|or)$/i.test(tail[1])) return null;
    rows.push({ label, cells });
  }
  if (rows.length < 3 || rows.length > 24) return null;
  const width = rows[0].cells.length;
  if (rows.some((r) => r.cells.length !== width)) return null;
  for (let c = 0; c < width; c++)
    if (new Set(rows.map((r) => unitOf(r.cells[c]))).size !== 1) return null;
  if (new Set(rows.map((r) => r.label.toLowerCase())).size !== rows.length) return null;
  if (rows.some((r) => r.label.split(" ").some((w) => LEAD.test(w)) && r.label.split(" ").length > 2)) return null;
  const kind = rows.every((r) => MONTHS.test(r.label.split(" ")[0]))
    ? "Month"
    : rows.every((r) => QUARTER.test(r.label.split(" ")[0]))
      ? "Quarter"
      : rows.every((r) => /^(?:19|20)\d{2}$/.test(r.label))
        ? "Year"
        : null;
  return { kind, width, rows };
}

const SINGULAR = {
  regions: "Region",
  region: "Region",
  categories: "Category",
  products: "Product",
  channels: "Channel",
  teams: "Team",
  countries: "Country",
  cities: "City",
  segments: "Segment",
  plans: "Plan",
  departments: "Department",
  stores: "Store",
  markets: "Market",
  sources: "Source",
};

const MEASURES =
  /\b(growth|revenue|sales|profit|cost|costs|spend|spending|users|visits|visitors|orders|signups|sign-ups|traffic|income|churn|margin|conversion|subscribers|attendance|score|scores)\b/i;

const cap = (word) => word[0].toUpperCase() + word.slice(1).toLowerCase();

function seriesNames(request, width) {
  if (width < 2) return [];
  const m = request.match(
    /\b(?:from|between|of|by|for)\s+([a-z][\w-]*(?: [a-z][\w-]*)?)\s+(?:versus|vs\.?|and|or|against|compared (?:to|with))\s+([a-z][\w-]*(?: [a-z][\w-]*)?)(?=[?.,;]|\s*$)/i,
  );
  const names = m ? [cap(m[1]), cap(m[2])] : [];
  while (names.length < width) names.push(`Series ${names.length + 1}`);
  return names.slice(0, width);
}

// A Markdown table in the shape Vaelo already knows how to chart.
export function seriesTable(request = "") {
  const series = suppliedSeries(request);
  if (!series) return null;
  const noun = request.match(
    /\b(regions?|categories|products?|channels?|teams?|countries|cities|segments|plans|departments|stores|markets|sources)\b/i,
  );
  const first = series.kind || (noun ? SINGULAR[noun[1].toLowerCase()] : "Category");
  const measure = request.match(MEASURES);
  const heads =
    series.width === 1
      ? [measure ? cap(measure[1]) : "Value"]
      : seriesNames(request, series.width);
  const cell = (x) => x.replace(/\|/g, "\\|");
  return {
    ...series,
    columns: [first, ...heads],
    markdown:
      `| ${[first, ...heads].join(" | ")} |\n|---|${heads.map(() => "---:").join("|")}|\n` +
      series.rows
        .map((r) => `| ${cell(r.label[0].toUpperCase() + r.label.slice(1))} | ${r.cells.map(cell).join(" | ")} |`)
        .join("\n"),
  };
}

// "Revenue $124,830, active users 8,412, refund rate 1.4%" -> labelled figures,
// units may differ. Needs two or more.
export function suppliedFigures(text = "") {
  if (typeof text !== "string" || text.length > 4000) return null;
  const flat = text.replace(/\s+/g, " ");
  const pattern = new RegExp(
    `([^\\d$€£¥₹%;,.:?!]*?)\\s*:?\\s*(${NUMBER})(?=\\s*(?:[,;.:?!]|\\band\\b|$))`,
    "g",
  );
  const items = [];
  let last = 0;
  for (const m of flat.matchAll(pattern)) {
    if (m.index < last) continue;
    last = m.index + m[0].length;
    let label = m[1];
    // A question mark or colon ends the lead-in: "numbers here? Revenue ..."
    label = label.split(/[?:]/).at(-1);
    label = labelFrom(label.replace(/^\s*(?:the|here|key)\s+/i, ""));
    if (!label || label.length > 40 || label.split(" ").length > 4) continue;
    if (DAY_OF_MONTH(label, m[2])) return null;
    if (label.split(" ").some((w) => LEAD.test(w))) continue;
    items.push({ label: label[0].toUpperCase() + label.slice(1), value: m[2] });
  }
  return items.length >= 2 && items.length <= 12 ? items : null;
}

const MONTH_DAY =
  /((?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?)\s*$/i;

// "discovery starts November 1, 2026; design November 8; ..." -> dated steps.
export function suppliedDates(text = "") {
  if (typeof text !== "string" || text.length > 4000) return null;
  const parts = text.replace(/\s+/g, " ").split(/;|\.(?=\s+[A-Z])/);
  const events = [];
  let year = "";
  for (const raw of parts) {
    const segment = raw.replace(/^.*:\s+/, "").replace(/[.!?]+$/, "").replace(/\s+and\s+/i, " ").trim();
    const m = segment.match(MONTH_DAY);
    if (!m) continue;
    const label = labelFrom(
      segment
        .slice(0, m.index)
        .replace(/\b(?:starts?|begins?|kicks off|opens?|ends?|is due|due|on|by|until|at)\s*$/i, "")
        .replace(/[,:\s]+$/, ""),
    );
    if (!label || label.split(" ").length > 4 || label.split(" ").some((w) => LEAD.test(w))) continue;
    let when = m[1].replace(/(\d)(?:st|nd|rd|th)/, "$1");
    const stated = when.match(/\d{4}$/)?.[0];
    if (stated) year = stated;
    else if (year) when += ", " + year;
    events.push({ when, label: label[0].toUpperCase() + label.slice(1) });
  }
  return events.length >= 3 && events.length <= 12 ? events : null;
}
