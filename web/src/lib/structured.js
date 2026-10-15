/* Some answers have an obvious shape: a handful of figures, or events in
   order. Vaelo writes those as small fenced blocks in plain lines, and the
   interface owns how they look. Parsing is line by line and forgiving, so a
   block that is still streaming in shows whatever has arrived so far. */

const DELTA = /\s*\(([+\-−–↑↓▲▼][^()]*|[^()]*%)\)\s*$/;

function direction(delta) {
  const sign = delta.trim()[0];
  if ("+↑▲".includes(sign)) return "up";
  if ("-−–↓▼".includes(sign)) return "down";
  return "flat";
}

/* "# Title", "> a note", and "Label: value (+2.1%)" lines. */
export function parseMetrics(source) {
  const result = { title: "", notes: [], items: [] };
  for (const raw of String(source || "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) {
      result.title ||= line.replace(/^#+\s*/, "");
      continue;
    }
    if (line.startsWith(">")) {
      result.notes.push(line.replace(/^>\s*/, ""));
      continue;
    }
    const at = line.indexOf(":");
    if (at <= 0) continue;
    const label = line.slice(0, at).replace(/^[-*•]\s*/, "").trim();
    let value = line.slice(at + 1).trim();
    let delta = "";
    const match = value.match(DELTA);
    if (match) {
      delta = match[1].trim();
      value = value.slice(0, match.index).trim();
    }
    if (!label || !value) continue;
    result.items.push({ label, value, ...(delta && { delta, direction: direction(delta) }) });
  }
  return result;
}

/* "When: what happened — more detail" lines, in the order written. */
export function parseTimeline(source) {
  const result = { title: "", events: [] };
  for (const raw of String(source || "").split("\n")) {
    const line = raw.trim().replace(/^[-*•]\s*/, "");
    if (!line) continue;
    if (line.startsWith("#")) {
      result.title ||= line.replace(/^#+\s*/, "");
      continue;
    }
    const at = line.indexOf(": ");
    if (at <= 0 || at > 40) continue;
    const rest = line.slice(at + 2).trim();
    const [what, ...detail] = rest.split(/\s+[—–]\s+|\s+--\s+/);
    if (!what) continue;
    result.events.push({
      when: line.slice(0, at).trim(),
      what: what.trim(),
      ...(detail.length && { detail: detail.join(" — ").trim() }),
    });
  }
  return result;
}

/* The same figures as plain text, for copying or for the minimal view. */
export function metricsText({ title, items, notes }) {
  return [
    title,
    ...items.map((item) => `${item.label}: ${item.value}${item.delta ? ` (${item.delta})` : ""}`),
    ...notes,
  ]
    .filter(Boolean)
    .join("\n");
}

export function timelineText({ title, events }) {
  return [
    title,
    ...events.map((event) => `${event.when}: ${event.what}${event.detail ? ` — ${event.detail}` : ""}`),
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
  const lines = markdown.slice(start, end).trimEnd().split("\n");
  const fence = lines[0].match(/^\s*(`{3,}|~{3,})/)?.[1];
  if (!fence) return true;
  return lines.length > 1 && lines[lines.length - 1].trim().startsWith(fence);
}
