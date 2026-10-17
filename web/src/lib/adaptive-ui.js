import { numberSeries } from './intelligent-ui.js';
import { chartable, isSectionRow } from './table.js';
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
  const values = plan.values.filter(i => i !== label && numberSeries(rows, i));
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

export function tablePresentation(columns, rows, context = '') {
  const result = { view: 'table', explore: false };
  if (rows.length < 2 || rows.length > 200 || columns.length > 20) return result;
  const headers = columns.map(value => String(value).toLowerCase());
  const numeric = headers.map((_, i) => i).filter(i => numberSeries(rows, i));
  if (!numeric.length) return result;
  const label = safeChartPlan(columns, rows)?.label ?? -1;
  const ingredients = headers.some(h => /\bingredient\b/.test(h)) && headers.some(h => /\b(?:quantity|amount|grams|weight)\b/.test(h));
  const budget = /\b(?:budget|expenses|cost breakdown)\b/i.test(context) && headers.some(h => /\b(?:cost|amount|expense)\b/.test(h));
  result.explore = ingredients || budget;
  if (result.explore || rows.length > 40 || columns.length > 3 || label < 0) return result;
  const timeSeries = TIME_COLUMN.test(headers[label]);
  const quantitative = headers.some(h => /\b(?:sales|revenue|visitors|visits|count|population|share|percentage|change|growth|signups|sign-ups|votes)\b/.test(h));
  const comparison = /\b(?:compare|comparison|options|plans|products|laptops|pricing)\b/i.test(context);
  if (!comparison && (timeSeries || quantitative)) result.view = 'chart';
  return result;
}
