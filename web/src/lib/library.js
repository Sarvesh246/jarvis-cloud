import { richPayload, wantsSourceReply } from "./rich-ui.js";
/* Durable work: the documents, code and tables Vaelo has made, kept apart
   from the conversations that produced them so the final version is never
   something you have to scroll back to find.

   Most of the library is read straight from the conversations. Only a
   document someone has edited or revised is stored, as a "work" on its
   conversation: { versions: [{ content, at, by, note }], current }. Its
   first version is always the reply as Vaelo wrote it. */

import { cellText } from "./table.js";
import { STRUCTURED, plainLine } from "./structured.js";
import { markdownFences, withoutFencedCode } from "./markdown-fences.js";

/* The same test the transcript uses to offer "Open" on a reply */
export function isLongReply(content = "") {
  return content.length > 1400 || /^#{1,3} /m.test(withoutCode(content));
}

/* A "# comment" in a code block isn't a heading. */
export function withoutCode(content = "") {
  return withoutFencedCode(String(content));
}

function plain(text) {
  return plainLine(text)
    .replace(/\s+/g, " ")
    .trim();
}

/* A document is named by its first heading, else its opening words */
export function docTitle(content = "", fallback = "Untitled document") {
  const heading = withoutCode(content).match(/^#{1,3}\s+(.+)$/m)?.[1];
  if (heading) return plain(heading).slice(0, 80);
  const outside = withoutCode(content);
  const line = outside.split("\n").map(plain).find((text) => text.length > 3);
  if (!line) return fallback;
  return line.length > 64 ? `${line.slice(0, 62).replace(/\s+\S*$/, "")}…` : line;
}

export function parseFences(content = "", requestText = '') {
  const fences = [];
  for (const block of markdownFences(content)) {
    if (!block.closed) continue;
    const language = block.language;
    if (STRUCTURED.has(language) || language === 'vaelo-work' || (language === 'vaelo-ui' && !wantsSourceReply(requestText))) continue;
    const source = block.source;
    if (richPayload(source, language, requestText)) continue;
    fences.push({ language, source, lines: source.split("\n").length });
  }
  return fences;
}

function cells(line) {
  const text = line.trim();
  const parts = [];
  let cell = '', slashes = 0;
  for (const char of text) {
    if (char === '|' && slashes % 2 === 0) { parts.push(cell); cell = ''; }
    else cell += char;
    slashes = char === '\\' ? slashes + 1 : 0;
  }
  parts.push(cell);
  if (text.startsWith('|')) parts.shift();
  if (text.endsWith('|') && parts.at(-1) === '') parts.pop();
  return parts.map(cell => cellText(plain(cell.replace(/\\\|/g, '|'))));
}

const INDENTED_CODE = /^(?: {4}| {0,3}\t)/;

function dividerWidth(line) {
  const text = line.endsWith('\r') ? line.slice(0, -1) : line;
  // Reject invalid characters before splitting. Overlapping whitespace in
  // one large separator regex otherwise backtracks on malformed long lines.
  if (INDENTED_CODE.test(text) || /[^ |:\t-]/.test(text) ||
      /^ {0,3}-[\t ]+\S/.test(text) || /^ *-+[\t ]*$/.test(text)) return 0;
  const parts = text.trim().split('|');
  if (parts[0] === '') parts.shift();
  if (parts.at(-1) === '') parts.pop();
  return parts.length && parts.every(part => /^:?-+:?$/.test(part.trim())) ? parts.length : 0;
}

/* GitHub-style Markdown tables, outside code fences */
export function parseTables(content = "") {
  const lines = withoutCode(content).split("\n");
  const tables = [];
  for (let i = 0; i < lines.length - 1; i += 1) {
    // GFM permits one hyphen per separator cell, but a bare "- | ..."
    // starts a list and a hyphen-only line underlines a heading.
    // Four-space/tab indentation belongs to a code block.
    if (!lines[i].includes("|") || INDENTED_CODE.test(lines[i])) continue;
    const width = dividerWidth(lines[i + 1]);
    if (!width) continue;
    const columns = cells(lines[i]);
    // A mismatched header/separator is prose, not a table. Count with the
    // same escaped-pipe rules used for the data to avoid inventing columns.
    if (columns.length !== width) continue;
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
    for (const [index, message] of messages.entries()) {
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
      const previous = messages[index + 1];
      const requestText = previous?.role === 'user' ? previous.text ?? previous.content ?? '' : '';
      parseFences(message.content, requestText).forEach((fence, i) => {
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
  const removed = new Map(chats.map(chat => [chat.id, new Set(chat.removedWork || [])]));
  return items.filter(item => !removed.get(item.chatId)?.has(item.id.slice(item.chatId.length + 1)));
}

// The transcript remains intact; saved removals keep derived artifacts out
// of both the library and Find after reloads and account sync.
export function removeLibraryItem(chat, id, at = Date.now()) {
  const key = id.slice(chat.id.length + 1);
  return { ...chat, updated: at, removedWork: [...new Set([...(chat.removedWork || []), key])] };
}

export function restoreLibraryItem(chat, id, at = Date.now()) {
  const key = id.slice(chat.id.length + 1);
  return { ...chat, updated: at, removedWork: (chat.removedWork || []).filter(item => item !== key) };
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
