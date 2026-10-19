import { toolDetail, toolInfo } from "./tools.js";

/* A reply at work should never look frozen. ChatGPT and Claude keep three
   things moving while a model is busy: the clock, the model's own thinking
   as it streams, and an honest "still …" once a step runs long. These are
   the words for that; Message.jsx decides where they go. */

/* After this long with nothing new on screen, the line says it is still at it. */
export const QUIET_MS = 12000;
/* After this long, a second line explains that slow steps are normal. */
export const LONG_QUIET_MS = 45000;

/* 9s, then 1m 39s: past a minute, bare seconds stop being readable. */
export function clock(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  return s < 60
    ? `${s}s`
    : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

/* What the model is doing between tools, named by what it just did:
   after a search it reads the results, after a page it reads the page. */
const AFTER = {
  search: "Going through the results",
  read: "Going through what it read",
  run: "Checking the output",
  file: "Going through the files",
  write: "Checking the change",
  memory: "Thinking with what it remembered",
};

export function afterStep(step) {
  if (!step) return "Thinking";
  return AFTER[toolInfo(step.tool ?? step.name).kind] || "Thinking";
}

/* "Reading a page" -> "Still reading a page". A tool with no verb of its own
   ("Web search") is said as working on it. */
export function stillLine(running) {
  const info = toolInfo(running.tool ?? running.name);
  const detail = toolDetail(running);
  const base =
    info.kind === "tool"
      ? `Still working on ${info.now.toLowerCase()}`
      : `Still ${info.now[0].toLowerCase()}${info.now.slice(1)}`;
  return `${base}${detail ? ` · ${detail}` : ""}`;
}

/* The newest thought, as one plain line: the tail of the last paragraph the
   model is writing to itself, without its Markdown. It changes as it
   streams, which is the point: the reader can see the work moving. */
export function thinkingPreview(reasoning = "", limit = 280) {
  const paragraphs = String(reasoning)
    .split(/\n\s*\n/)
    .map((part) =>
      part
        .replace(/[*_`#>]+/g, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);
  let last = paragraphs.at(-1) || "";
  /* A finished one-liner ("Let me try fetching them.") means nothing alone:
     keep the paragraph before it so "them" has something to point at. */
  if (paragraphs.length > 1 && last.length < 50 && /[.!?]$/.test(last)) last = paragraphs.at(-2) + " " + last;
  if (last.length <= limit) return last;
  const tail = last.slice(-limit);
  const start = tail.indexOf(" ");
  return `…${start > 0 && start < 24 ? tail.slice(start + 1) : tail}`;
}
