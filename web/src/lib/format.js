import { hasConversation } from './slash-history.js';

export function greeting(date = new Date()) {
  const hour = date.getHours();
  if (hour < 5) return "Still up";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function firstName(name = "") {
  return String(name).trim().split(/\s+/)[0] || "";
}

export { humanizeTool } from "./tools.js";

// Local calendar days can be 23, 24, 25 (or even fractional) hours long.
function dayStart(now, offset = 0) {
  const date = new Date(now);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset).getTime();
}

// Multipart messages carry text beside images. Never stringify their objects
// or include image URLs in the conversation index. An authored user caption,
// including an empty one, takes precedence over composed attachment context.
function messageText(message) {
  const content = message.role === 'user' ? message.text ?? message.content : message.content;
  if (typeof content === 'string') return content;
  return Array.isArray(content) ? content
    .filter(part => part?.type === 'text' && typeof part.text === 'string')
    .map(part => part.text).join('\n') : '';
}

// Lowercasing can expand a character (İ -> i + combining dot). Search uses
// folded text, but excerpt boundaries must refer to the original characters.
function matchRange(text, needle) {
  const folded = text.toLowerCase();
  const at = folded.indexOf(needle);
  if (at < 0) return null;
  const end = at + needle.length;
  if (folded.length === text.length) return [at, end];
  let original = 0, offset = 0, from;
  for (const char of text) {
    const after = offset + char.toLowerCase().length;
    if (from === undefined && after > at) from = original;
    original += char.length;
    if (after >= end) return [from, original];
    offset = after;
  }
  return null;
}

/* Pinned first, then newest first, grouped by how long ago the conversation
   was touched. */
export function groupChats(chats, now = Date.now()) {
  const start = dayStart(now);
  const yesterday = dayStart(now, -1);
  const groups = [
    { label: "Pinned", items: [] },
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "Earlier", items: [] },
  ];
  chats.filter(hasConversation)
    .sort((a, b) => (b.updated || 0) - (a.updated || 0))
    .forEach((chat) => {
      const at = chat.updated || 0;
      const bucket = chat.pinned ? 0 : at >= start ? 1 : at >= yesterday ? 2 : 3;
      groups[bucket].items.push(chat);
    });
  return groups.filter((group) => group.items.length);
}

/* The last thing said in a conversation, in plain words, for a list row */
export function previewOf(chat) {
  for (let i = chat.messages.length - 1; i >= 0; i -= 1) {
    const message = chat.messages[i];
    const raw = messageText(message);
    const text = raw
      .replace(/(```|~~~)[\s\S]*?(\1|$)/g, " ")
      .replace(/\]\([^)]*\)/g, "]")
      .replace(/[#*_`>[\]|]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (text) return text.slice(0, 120);
  }
  return "";
}

/* When, in the fewest words: a time today, "Yest.", a weekday, then a date */
export function timeLabel(at, now = Date.now()) {
  if (!at) return "";
  const today = dayStart(now);
  const date = new Date(at);
  if (at >= today) return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (at >= dayStart(now, -1)) return "Yest.";
  if (at >= dayStart(now, -6)) return date.toLocaleDateString(undefined, { weekday: "short" });
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/* Matches titles first, then anything said in the conversation. Returns the
   matching chats with a short excerpt around the first hit in the text. */
export function searchChats(chats, query) {
  const needle = String(query).replace(/\s+/g, " ").trim().toLowerCase();
  if (!needle) return null;
  const results = [];
  for (const chat of chats) {
    if (!hasConversation(chat)) continue;
    if (chat.title.toLowerCase().includes(needle)) {
      results.push({ chat, excerpt: "" });
      continue;
    }
    for (const message of chat.messages) {
      const raw = messageText(message).replace(/\s+/g, " ");
      /* Text is searched as written ("my_variable", "C#") and with Markdown
         marks removed ("**bold**" finds "bold"); the excerpt comes from
         whichever matched. */
      const plain = raw
        .replace(/\]\([^)]*\)/g, "]")
        .replace(/[#*_`>[\]|]/g, "");
      const rawRange = matchRange(raw, needle);
      const text = rawRange ? raw : plain;
      const range = rawRange || matchRange(plain, needle);
      if (!range) continue;
      const [at, end] = range;
      /* A narrow rail shows little, so the excerpt starts just before the hit */
      const from = Math.max(0, at - 12);
      results.push({
        chat,
        excerpt: `${from ? "…" : ""}${text.slice(from, end + 48).trim()}…`,
      });
      break;
    }
  }
  return results;
}
