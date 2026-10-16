/* Durable work: the documents, code and tables Vaelo has made, kept apart
   from the conversations that produced them so the final version is never
   something you have to scroll back to find.

   Most of the library is read straight from the conversations. Only a
   document someone has edited or revised is stored, as a "work" on its
   conversation: { versions: [{ content, at, by, note }], current }. Its
   first version is always the reply as Vaelo wrote it. */

import { cellText } from "./table.js";
import { STRUCTURED } from "./structured.js";

/* The same test the transcript uses to offer "Open" on a reply */
export function isLongReply(content = "") {
  return content.length > 1400 || /^#{1,3} /m.test(withoutCode(content));
}

/* A "# comment" in a code block isn't a heading. */
export function withoutCode(content = "") {
  return String(content).replace(/```[\s\S]*?(```|$)/g, "").replace(/~~~[\s\S]*?(~~~|$)/g, "");
}

function plain(text) {
  return String(text)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/* A document is named by its first heading, else its opening words */
export function docTitle(content = "", fallback = "Untitled document") {
  const heading = withoutCode(content).match(/^#{1,3}\s+(.+)$/m)?.[1];
  if (heading) return plain(heading).slice(0, 80);
  const outside = content.replace(/```[\s\S]*?(```|$)/g, "");
  const line = outside.split("\n").map(plain).find((text) => text.length > 3);
  if (!line) return fallback;
  return line.length > 64 ? `${line.slice(0, 62).replace(/\s+\S*$/, "")}…` : line;
}

export function parseFences(content = "") {
  const fences = [];
  const pattern = /^```([\w+-]*)[^\n]*\n([\s\S]*?)^```\s*$/gm;
  for (const match of content.matchAll(pattern)) {
    const language = match[1].toLowerCase();
    if (STRUCTURED.has(language) || language === "vaelo-work") continue;
    const source = match[2].replace(/\n$/, "");
    fences.push({ language, source, lines: source.split("\n").length });
  }
  return fences;
}

function cells(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cellText(plain(cell.replace(/\\\|/g, "|"))));
}

const DIVIDER = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

/* GitHub-style Markdown tables, outside code fences */
export function parseTables(content = "") {
  const lines = content.replace(/```[\s\S]*?(```|$)/g, "").split("\n");
  const tables = [];
  for (let i = 0; i < lines.length - 1; i += 1) {
    if (!lines[i].includes("|") || !DIVIDER.test(lines[i + 1])) continue;
    const columns = cells(lines[i]);
    const rows = [];
    let j = i + 2;
    for (; j < lines.length && lines[j].includes("|") && lines[j].trim(); j += 1) {
      const row = cells(lines[j]);
      rows.push(columns.map((_, k) => row[k] ?? ""));
    }
    if (rows.length) tables.push({ columns, rows });
    i = j - 1;
  }
  return tables;
}

const CODE_LINES = 12;
const TABLE_ROWS = 3;

function languageName(language) {
  if (!language) return "Code";
  return language.length <= 4 ? language.toUpperCase() : language[0].toUpperCase() + language.slice(1);
}

/* Everything worth keeping, newest conversation first. Each entry carries
   the workspace item that opens it. */
export function collectWork(chats) {
  const items = [];
  const ordered = [...chats].sort((a, b) => (b.updated || 0) - (a.updated || 0));
  for (const chat of ordered) {
    const works = chat.works || {};
    const seen = new Set();
    const messages = [...chat.messages].reverse();
    for (const message of messages) {
      if (message.role !== "assistant" || !message.content) continue;
      const work = works[message.id];
      if (work || isLongReply(message.content)) {
        seen.add(message.id);
        const content = work ? currentContent(work, message.content) : message.content;
        items.push({
          id: `${chat.id}:${message.id}:doc`,
          kind: "document",
          title: docTitle(content, chat.title),
          edited: !!work && work.versions.length > 1,
          chatId: chat.id,
          chatTitle: chat.title,
          updated: work?.versions[work.current]?.at || chat.updated || 0,
          item: { kind: "document", messageId: message.id },
        });
      }
      parseFences(message.content).forEach((fence, i) => {
        if (fence.lines < CODE_LINES && !["html", "svg"].includes(fence.language)) return;
        items.push({
          id: `${chat.id}:${message.id}:code:${i}`,
          kind: "code",
          title: `${languageName(fence.language)} · ${fence.lines} lines`,
          chatId: chat.id,
          chatTitle: chat.title,
          updated: chat.updated || 0,
          item: {
            kind: "code",
            messageId: message.id,
            language: fence.language,
            source: fence.source,
            title: `${languageName(fence.language)} snippet`,
          },
        });
      });
      parseTables(message.content).forEach((table, i) => {
        if (table.rows.length < TABLE_ROWS) return;
        items.push({
          id: `${chat.id}:${message.id}:table:${i}`,
          kind: "table",
          title: table.columns.filter(Boolean).slice(0, 3).join(", ") || "Table",
          chatId: chat.id,
          chatTitle: chat.title,
          updated: chat.updated || 0,
          item: {
            kind: "table",
            messageId: message.id,
            columns: table.columns,
            rows: table.rows,
            title: `Table · ${table.rows.length} rows`,
          },
        });
      });
    }
    /* A reworked document outlives the reply it began as (a retried reply
       gets a new id), so its work still has a place in the library. */
    for (const [messageId, work] of Object.entries(works)) {
      if (seen.has(messageId) || !work?.versions?.length) continue;
      const content = currentContent(work);
      items.push({
        id: `${chat.id}:${messageId}:doc`,
        kind: "document",
        title: docTitle(content, chat.title),
        edited: work.versions.length > 1,
        chatId: chat.id,
        chatTitle: chat.title,
        updated: work.versions[work.current]?.at || 0,
        item: { kind: "document", messageId },
      });
    }
  }
  return items;
}

export function searchWork(items, query) {
  const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return items;
  return items.filter((entry) => {
    const text = `${entry.title} ${entry.chatTitle} ${entry.kind}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

/* ---------- Versions ---------- */

export const MAX_VERSIONS = 20;

export function currentContent(work, fallback = "") {
  return work?.versions?.[work.current]?.content ?? fallback;
}

/* A new version always becomes current. The original is never dropped;
   past the cap, the oldest edits after it go first. */
export function addVersion(work, original, content, by, note = "", at = Date.now()) {
  const base = work?.versions?.length
    ? work.versions
    : [{ content: original, at, by: "vaelo", note: "As Vaelo wrote it" }];
  let versions = [...base, { content, at, by, ...(note && { note: note.slice(0, 200) }) }];
  if (versions.length > MAX_VERSIONS) versions = [versions[0], ...versions.slice(-(MAX_VERSIONS - 1))];
  return { versions, current: versions.length - 1 };
}

/* ---------- Revising a passage ---------- */

export function spliceSource(source, start, end, replacement) {
  const before = source.slice(0, start);
  const after = source.slice(end);
  return `${before}${replacement.replace(/^\n+|\n+$/g, "")}${after}`;
}

export const PASSAGE_LIMIT = 6000;
const CONTEXT_LIMIT = 7000;

/* What Vaelo is asked when you select part of a document and say how it
   should change. It sees the passage, the instruction and enough of the
   document around it to keep the voice; it answers with the passage only. */
export function revisionPrompt({ source, start, end, instruction }) {
  const passage = source.slice(start, end);
  const room = Math.max(0, CONTEXT_LIMIT - passage.length);
  const from = Math.max(0, start - Math.floor(room / 2));
  const to = Math.min(source.length, end + Math.ceil(room / 2));
  const context = `${from ? "…\n" : ""}${source.slice(from, start)}[[PASSAGE]]${source.slice(end, to)}${to < source.length ? "\n…" : ""}`;
  return [
    "Revise a passage of a document. Reply with only the rewritten passage in Markdown: no preamble, no explanation, no code fence around it, and keep any formatting the passage already uses unless the instruction changes it.",
    "",
    `Instruction: ${instruction.trim().slice(0, 500)}`,
    "",
    "Passage:",
    "<<<",
    passage,
    ">>>",
    "",
    "The document around it, where [[PASSAGE]] marks its place (for tone and context only; do not rewrite it):",
    "<<<",
    context,
    ">>>",
  ].join("\n");
}

/* Models sometimes wrap the answer in a fence anyway */
export function cleanRevision(text) {
  const trimmed = String(text).trim();
  const fenced = trimmed.match(/^```(?:markdown|md)?\n([\s\S]*?)\n```$/);
  return (fenced ? fenced[1] : trimmed).replace(/^(<<<|>>>)\n?|\n?(<<<|>>>)$/g, "").trim();
}
