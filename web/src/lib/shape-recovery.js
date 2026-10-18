import { plainLine } from "./structured.js";

// Models often answer with headed sections, bold-titled bullets, ranked lists or
// figures buried in a sentence even when a table or timeline fits better. These
// helpers only restructure data already in the answer; they never add content.
const DATE_HEAD =
  /^(?:(?:mon|tues|wednes|thurs|fri|satur|sun)day|(?:day|week|month|phase|stage|year|q[1-4])\s*\d{0,4}|(?:19|20)\d{2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:\s+\d{1,4})?)\b/i;
const PERIOD =
  "(?:Q[1-4](?:\\s+\\d{4})?|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\.?(?:\\s+\\d{4})?|(?:19|20)\\d{2})";
const FIGURE = "[$€£₹]?-?\\d[\\d,]*(?:\\.\\d+)?\\s?(?:%|[kKmMbB]\\b|million|billion|thousand)?";
const BULLET = /^\s*(?:[-*+•]|\d+[.)])\s+(.+)$/;
const NUMERIC_VALUE = /^[$€£₹]?-?\d[\d,]*(?:\.\d+)?\s?(?:%|[kKmMbB]\b|[A-Za-z%]{1,14}(?:\s[A-Za-z%]{1,10})?)?$/;
const OPPOSED = [
  [/^(?:pros|advantages|benefits|upsides|strengths)\b/i, /^(?:cons|disadvantages|drawbacks|downsides|weaknesses|risks)\b/i],
];

const cell = (text) => plainLine(text).replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
const table = (rows) =>
  rows
    .map((row, i) => "| " + row.map(cell).join(" | ") + " |" + (i === 0 ? "\n|" + row.map(() => "---").join("|") + "|" : ""))
    .join("\n");

/* "## Title" or a lone "**Title**" / "**Title:**" line, followed by bullets. */
export function groupedBullets(content = "") {
  const lines = content.split("\n");
  const intro = [];
  const groups = [];
  const outro = [];
  let current = null;
  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = line.match(/^#{2,4}\s+(.+?)\s*#*$/) || line.match(/^\*\*([^*\n]{1,80}?)\*\*:?\s*$/);
    if (heading) {
      if (outro.length) return null;
      current = { title: plainLine(heading[1]).replace(/:$/, ""), items: [], prose: [] };
      groups.push(current);
      continue;
    }
    if (!line.trim()) continue;
    if (!current) {
      intro.push(line);
      continue;
    }
    const bullet = line.match(BULLET);
    if (bullet && !outro.length) current.items.push(bullet[1].trim());
    else if (groups.length && current.items.length) outro.push(line);
    else current.prose.push(line);
  }
  return groups.length >= 2 && groups.length <= 12 ? { intro: intro.join("\n"), groups, outro: outro.join("\n") } : null;
}

const rest = ({ intro, outro }) => [intro, outro].filter(Boolean).join("\n\n");
const labeled = (item) => {
  const m = plainLine(item).match(/^([^:—–]{1,40}?)\s*(?::|\s[—–]\s)\s*(.{1,200})$/);
  return m ? [m[1].trim(), m[2].trim()] : null;
};

/* "Day 1: Old town" headings with their bullets become a timeline. */
export function headedTimeline(content) {
  const parsed = groupedBullets(content);
  if (!parsed || !parsed.groups.every((g) => DATE_HEAD.test(g.title))) return null;
  if (parsed.groups.some((g) => !g.items.length && !g.prose.length && !/[:—–-]\s*\S/.test(g.title))) return null;
  const lines = parsed.groups.map((g) => {
    const m = g.title.match(/^(.{1,40}?)\s*(?::|\s[—–-]\s)\s*(.+)$/);
    const when = m ? m[1] : g.title;
    const what = m ? m[2] : g.items[0] || g.prose[0];
    const detail = (m ? g.items : g.items.slice(1)).map((x) => plainLine(x)).join(" · ");
    return `${when}: ${plainLine(what)}${detail ? " — " + detail : ""}`;
  });
  return { language: "timeline", source: lines.join("\n"), markdown: rest(parsed) };
}

/* Sections that list the same labelled facts become one comparison table. */
export function headedComparison(content) {
  const parsed = groupedBullets(content);
  if (!parsed || parsed.groups.length > 6) return null;
  const opposed = OPPOSED.find(([a, b]) => parsed.groups.length === 2 && a.test(parsed.groups[0].title) && b.test(parsed.groups[1].title));
  if (opposed && parsed.groups.every((g) => g.items.length)) {
    const [pros, cons] = parsed.groups;
    const height = Math.max(pros.items.length, cons.items.length);
    const rows = [[pros.title, cons.title]];
    for (let i = 0; i < height; i++) rows.push([pros.items[i] || "", cons.items[i] || ""]);
    return { markdown: [parsed.intro, table(rows), parsed.outro].filter(Boolean).join("\n\n") };
  }
  const facts = parsed.groups.map((g) => g.items.map(labeled));
  if (facts.some((list) => !list.length || list.some((x) => !x))) return null;
  const names = facts.map((list) => list.map(([label]) => label.toLowerCase()));
  const shared = names[0].filter((label) => names.every((list) => list.includes(label)));
  if (shared.length < 2) return null;
  const rows = [["", ...parsed.groups.map((g) => g.title)]];
  for (const label of shared) {
    const display = facts[0].find(([l]) => l.toLowerCase() === label)[0];
    rows.push([display, ...facts.map((list) => list.find(([l]) => l.toLowerCase() === label)[1])]);
  }
  return { markdown: [parsed.intro, table(rows), parsed.outro].filter(Boolean).join("\n\n") };
}

/* "1. New York — 8.3 million" style rankings with one figure each. */
export function rankedFigures(content) {
  const lines = content.split("\n").filter((l) => l.trim());
  const items = lines.map((l) => l.match(/^\s*(\d{1,2})[.)]\s+(.+)$/));
  if (items.length < 3 || items.length > 30 || items.some((m) => !m)) return null;
  const rows = items.map((m) => labeled(m[2]));
  if (rows.some((r) => !r || !NUMERIC_VALUE.test(plainLine(r[1])))) return null;
  return { markdown: table([["#", "Item", "Value"], ...rows.map(([label, value], i) => [String(i + 1), label, value])]) };
}

/* "Q1: $120k, Q2: $150k, Q3: $180k" inside a sentence becomes a period table. */
export function periodFigures(content) {
  const found = [...content.matchAll(new RegExp(`\\b(${PERIOD})\\s*(?::|=|was|at)\\s*(${FIGURE})`, "gi"))];
  if (found.length < 3 || found.length > 24) return null;
  const first = found[0];
  const last = found.at(-1);
  const span = content.slice(first.index, last.index + last[0].length);
  if (span.includes("\n\n") || /^\s*\|/.test(span)) return null;
  const before = content.slice(0, first.index).replace(/[\s,;:]+$/, "");
  const after = content.slice(last.index + last[0].length).replace(/^[\s.,;]+/, "");
  const rows = [["Period", "Value"], ...found.map((m) => [m[1], m[2].trim()])];
  return { markdown: [before && before + ".", table(rows), after].filter(Boolean).join("\n\n") };
}
