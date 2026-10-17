/* Some answers have an obvious shape: a handful of figures, or events in
   order. Vaelo writes those as small fenced blocks in plain lines, and the
   interface owns how they look. Parsing is line by line and forgiving, so a
   block that is still streaming in shows whatever has arrived so far. */

import { markdownFences } from './markdown-fences.js';

const DELTA = /\s*\(([+\-−–↑↓▲▼][^()]*|[^()]*%)\)\s*$/;

function direction(delta) {
  const sign = delta.trim()[0];
  if ("+↑▲".includes(sign)) return "up";
  if ("-−–↓▼".includes(sign)) return "down";
  return "flat";
}

/* Models often bold a label ("**Revenue:** $4.2B") or link a figure. The
   block is drawn as plain text, so the marks come off before the line is
   read; otherwise the colon inside the bold splits it in the wrong place.
   A lone asterisk ("5 * 3") isn't emphasis and stays. */
export function plainLine(text) {
  return String(text)
    .replace(/!?\[([^\]]*)\]\((?:[^()\s]|\([^()\s]*\))*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, "$2")
    .replace(/(^|[^\w*])\*(?=\S)([^*]+?)(?<=\S)\*(?![\w*])/g, "$1$2")
    .replace(/(^|[^\w_])_(?=\S)([^_]+?)(?<=\S)_(?![\w_])/g, "$1$2")
    .replace(/~~(?=\S)(.+?)(?<=\S)~~/g, "$1")
    .trim();
}

/* "# Title", "> a note", and "Label: value (+2.1%)" lines. A line that fits
   none of these is kept in `extra`: while the block streams it is usually
   half a figure, but once the block is finished it is still something the
   reply said, so the block shows it instead of dropping it. */
export function parseMetrics(source) {
  const result = { title: "", notes: [], items: [], extra: [] };
  for (const raw of String(source || "").split("\n")) {
    const line = plainLine(raw);
    if (!line) continue;
    if (line.startsWith("#")) {
      const heading = line.replace(/^#+\s*/, "");
      if (!result.title) result.title = heading;
      else result.extra.push(heading);
      continue;
    }
    if (line.startsWith(">")) {
      result.notes.push(line.replace(/^>\s*/, ""));
      continue;
    }
    const at = line.indexOf(":");
    /* "https://…" on its own is an address, not a figure called "https" */
    if (at <= 0 || /^https?$/i.test(line.slice(0, at))) {
      result.extra.push(line);
      continue;
    }
    const label = line.slice(0, at).replace(/^[-*•]\s*/, "").trim();
    let value = line.slice(at + 1).trim();
    let delta = "";
    const match = value.match(DELTA);
    if (match) {
      delta = match[1].trim();
      value = value.slice(0, match.index).trim();
    }
    if (!label || !value) {
      result.extra.push(line);
      continue;
    }
    result.items.push({ label, value, ...(delta && { delta, direction: direction(delta) }) });
  }
  return result;
}

/* "When: what happened — more detail" lines, in the order written. A date
   and a dash ("2019 — Founded") reads the same way when there's no colon.
   Lines that fit neither are kept in `extra`, as for figures; `rows` holds
   both in the order written, for a finished block. */
const DASHED = /^([^:]{0,40}?\d[^:]{0,40}?)\s+[—–]\s+(.+)$/;

export function parseTimeline(source) {
  const result = { title: "", events: [], extra: [], rows: [] };
  for (const raw of String(source || "").split("\n")) {
    /* "* 2019" is a bullet; "*2019*" is emphasis and plainLine takes it */
    const line = plainLine(raw.trim().replace(/^(?:[-•]\s*|\*\s+)/, ""));
    if (!line) continue;
    if (line.startsWith("#")) {
      const heading = line.replace(/^#+\s*/, "");
      if (!result.title) result.title = heading;
      else { result.extra.push(heading); result.rows.push({when: '', what: heading}); }
      continue;
    }
    const at = line.indexOf(": ");
    const colon = at > 0 && at <= 160;
    const dashed = colon ? null : line.match(DASHED);
    const when = colon ? line.slice(0, at).trim() : dashed?.[1].trim() || "";
    const rest = colon ? line.slice(at + 2).trim() : dashed?.[2] || "";
    const [what, ...detail] = rest.split(/\s+[—–]\s+|\s+--\s+/);
    if (!when || !what) {
      result.extra.push(line);
      result.rows.push({ when: "", what: line });
      continue;
    }
    const event = {
      when,
      what: what.trim(),
      ...(detail.length && { detail: detail.join(" — ").trim() }),
    };
    result.events.push(event);
    result.rows.push(event);
  }
  return result;
}

/* The same figures as plain text, for copying or for the minimal view. */
export function metricsText({ title, items, notes, extra = [] }) {
  return [
    title,
    ...items.map((item) => `${item.label}: ${item.value}${item.delta ? ` (${item.delta})` : ""}`),
    ...notes,
    ...extra,
  ]
    .filter(Boolean)
    .join("\n");
}

export function timelineText({ title, events, rows = events }) {
  return [
    title,
    ...rows.map(
      (event) => `${event.when ? `${event.when}: ` : ""}${event.what}${event.detail ? ` — ${event.detail}` : ""}`,
    ),
  ]
    .filter(Boolean)
    .join("\n");
}

export const STRUCTURED = new Set(["metrics", "timeline"]);

/* Whether the fenced block between `start` and `end` in the Markdown has its
   closing fence yet, so a shape can tell a half-streamed block from a
   finished one. Without positions, a block counts as finished. */
export function fenceClosed(markdown, start, end) {
  if (start == null || end == null || !markdown) return true;
  const block = markdownFences(markdown.slice(start, end))[0];
  return block ? block.closed : true;
}
