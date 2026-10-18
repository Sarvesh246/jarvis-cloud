import { numberSeries } from './intelligent-ui.js';
import { cellText, chartable, isSectionRow, isBlank, toNumber } from './table.js';
import { plainLine, parseMetrics, parseTimeline } from './structured.js';

// These are presentation decisions over existing data, never model requests.
export function requestForReply(messages, index) {
  const previous = messages[index - 1];
  const text = previous?.text ?? previous?.content;
  return previous?.role === 'user' && typeof text === 'string' ? text : '';
}

export function wantsPlainReply(request = '') {
  if (typeof request !== 'string') return false;
  return /\b(?:plain text|prose only|text only|no (?:widgets|charts|tables|interactive (?:ui|elements)))\b/i.test(request);
}

export function sectionContext(content = '', offset = 0) {
  const before = content.slice(Math.max(0, offset - 8000), offset);
  const headings = [...before.matchAll(/^#{1,6}\s+(.+)$/gm)];
  return headings.at(-1)?.[1] || before.slice(-400);
}

const DATE_LABEL = /^(?:(?:mon|tues|wednes|thurs|fri|satur|sun)day(?:,?\s+.{1,20})?|(?:day|week|month|phase)\s+\d{1,3}|(?:19|20)\d{2}(?:-\d{2}(?:-\d{2})?)?|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+\d{1,4}){0,2}|\d{1,2}(?::\d{2})?\s*(?:am|pm)|\d{1,2}:\d{2})$/i;
const NUMBER = /^[-+−]?[$€£¥₹]?[-+−]?(?:\d[\d,]*(?:\.\d+)?|\.\d+)[kmb%]?(?:\s+(?:km|kg|g|ml|l|hours?|hrs?|minutes?|mins?|days?|visits?|orders?|members?|units?))?(?:\s*\([+−\-↑↓▲▼][^()]{1,24}\))?$/i;
const ACTION = /^(?:add|arrange|back up|book|bring|buy|call|charge|check|choose|clean|clear|collect|compare|confirm|create|download|draft|fill|gather|install|make|open|pack|pay|prepare|print|read|register|remove|reserve|review|save|schedule|send|set|sort|submit|test|update|verify|wash|write)\b/i;
const TIME_COLUMN = /\b(?:date|month|week|year|quarter|day|period)\b/i;

export function safeChartPlan(columns, rows) {
  rows = rows.filter(row => !isSectionRow(row));
  const plan = chartable(columns, rows);
  if (!plan) return null;
  const time = columns.findIndex(header => TIME_COLUMN.test(header));
  const label = time >= 0 ? time : plan.label;
  const values = plan.values.filter(i => i !== label && numberSeries(rows.filter(row => !isBlank(row[i])), i));
  return values.length ? { label, values } : null;
}

export function inferListPresentation(lines, { context = '', rich = false } = {}) {
  if (!Array.isArray(lines) || lines.length < 2 || lines.length > 80 || lines.join('').length > 50000) return null;
  const clean = lines.map(line => plainLine(line).trim());
  if (!rich && clean.length <= 30) {
    const dated = clean.map(line => {
      const match = line.match(/^(.{1,40}?)(?::\s+|\s+[—–]\s+)(.+)$/);
      return match && DATE_LABEL.test(match[1]) ? `${match[1]}: ${match[2]}` : null;
    });
    if (dated.every(Boolean)) {
      const source = dated.join('\n');
      if (parseTimeline(source).events.length === clean.length) return { kind: 'timeline', source };
    }
    if (clean.length <= 8 && clean.every(line => {
      const match = line.match(/^([^:]{1,60}):\s*(.+)$/);
      return match && NUMBER.test(match[2]);
    })) {
      const source = clean.join('\n');
      if (parseMetrics(source).items.length === clean.length) return { kind: 'metrics', source };
    }
  }
  const taskHeading = /\b(?:checklist|packing|shopping list|to[- ]do|next steps|action (?:items|plan)|before you (?:go|leave|start)|preparation)\b/i.test(context);
  // Information lists stay as information, even when a word sounds like a verb.
  const information = /\b(?:symptoms|side effects|benefits|drawbacks|pros and cons|definitions|examples|features)\b/i.test(context);
  if (!information && (taskHeading || clean.every(line => ACTION.test(line)))) return { kind: 'checklist' };
  return null;
}

// What the person asked decides the shape: a comparison stays a table, a trend
// or a share-of-whole becomes a chart, and an explicit "in a table" always wins.
const ASKS_TABLE = /\b(?:(?:in|as|into) (?:a |the )?table|table (?:form|format|view))\b/i;
const ASKS_CHART = /\b(?:chart|graph|plot|visuali[sz]e|visuali[sz]ation|trend(?:s|line)?|over time|growth|history of|how (?:has|have|did).{0,40}(?:changed?|grown?|moved?)|breakdown|distribution|share of|market share|proportion|split (?:by|between)|per (?:month|year|week|quarter)|month by month|year[- ]over[- ]year|by (?:month|year|quarter|week))\b/i;
const ASKS_COMPARE = /\b(?:compare|comparison|versus|vs|which (?:one|is|should)|better|differences? between|pros and cons|choose between|shortlist|alternatives?|side by side)\b/i;
export function requestIntent(request = '') {
  if (typeof request !== 'string' || !request) return null;
  if (ASKS_TABLE.test(request)) return 'table';
  if (ASKS_CHART.test(request) && !ASKS_COMPARE.test(request)) return 'chart';
  if (ASKS_COMPARE.test(request)) return 'table';
  return null;
}

const TOTAL_LABEL = /^(?:grand total|total|overall|sum|net|subtotal)\b/i;
const SUMMARY_CONTEXT = /\b(?:summary|overview|snapshot|at a glance|key (?:numbers|figures|stats|metrics)|highlights|totals?|dashboard)\b/i;

// Label and amount rows that can stand as cards: nothing time-ordered, one unit.
export function overviewItems(columns, rows, max = 8) {
  rows = rows.filter(row => !isSectionRow(row));
  if (columns.length < 2 || columns.length > 3 || rows.length < 2 || rows.length > max) return null;
  if (TIME_COLUMN.test(String(columns[0])) || !numberSeries(rows, 1)) return null;
  const items = rows.map(row => ({ label: cellText(row[0]), value: cellText(row[1]), detail: columns.length === 3 ? cellText(row[2]) : '' }));
  if (items.some(item => !item.label || !item.value || item.label.length > 60 || item.value.length > 40 || item.detail.length > 120 || Number.isFinite(toNumber(item.label)))) return null;
  if (rows.every(row => DATE_LABEL.test(cellText(row[0])))) return null;
  return items.map(({ detail, ...item }) => detail ? { ...item, detail } : item);
}

function summaryLike(rows, context) {
  if (/\b(?:compare|comparison|options|plans|products|laptops|pricing|versus)\b/i.test(context)) return false;
  return rows.some(row => TOTAL_LABEL.test(cellText(row[0]).trim())) || SUMMARY_CONTEXT.test(context);
}

export function tablePresentation(columns, rows, context = '', request = '') {
  const result = { view: 'table', explore: false };
  if (rows.length < 2 || rows.length > 200 || columns.length > 20) return result;
  const headers = columns.map(value => String(value).toLowerCase());
  const numeric = headers.map((_, i) => i).filter(i => numberSeries(rows, i));
  if (!numeric.length) return result;
  const label = safeChartPlan(columns, rows)?.label ?? -1;
  const ingredients = headers.some(h => /\bingredient\b/.test(h)) && headers.some(h => /\b(?:quantity|amount|grams|weight)\b/.test(h));
  const budget = /\b(?:budget|expenses|cost breakdown)\b/i.test(context) && headers.some(h => /\b(?:cost|amount|expense)\b/.test(h));
  result.explore = ingredients || budget;
  const intent = requestIntent(request);
  // A short label and amount summary, especially one that ends in a total, reads
  // best as cards without anyone asking for them.
  if (!intent && !result.explore && overviewItems(columns, rows) && summaryLike(rows, context)) { result.view = 'cards'; return result; }
  if (label < 0 || intent === 'table') return result;
  if (intent === 'chart' && !result.explore) { result.view = 'chart'; return result; }
  if (result.explore || columns.length > 3) return result;
  const timeSeries = TIME_COLUMN.test(headers[label]);
  const quantitative = headers.some(h => /\b(?:sales|revenue|visitors|visits|count|population|share|percentage|change|growth|signups|sign-ups|votes)\b/.test(h));
  const comparison = /\b(?:compare|comparison|options|plans|products|laptops|pricing)\b/i.test(context);
  if (!comparison && (timeSeries || quantitative)) result.view = 'chart';
  return result;
}
