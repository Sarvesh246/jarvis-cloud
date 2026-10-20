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

const DAY = 86_400_000;

/* Pinned first, then newest first, grouped by how long ago the conversation
   was touched. */
export function groupChats(chats, now = Date.now()) {
  const start = new Date(now).setHours(0, 0, 0, 0);
  const groups = [
    { label: "Pinned", items: [] },
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "Earlier", items: [] },
  ];
  [...chats]
    .sort((a, b) => (b.updated || 0) - (a.updated || 0))
    .forEach((chat) => {
      const at = chat.updated || 0;
      const bucket = chat.pinned ? 0 : at >= start ? 1 : at >= start - DAY ? 2 : 3;
      groups[bucket].items.push(chat);
    });
  return groups.filter((group) => group.items.length);
}

/* The last thing said in a conversation, in plain words, for a list row */
export function previewOf(chat) {
  for (let i = chat.messages.length - 1; i >= 0; i -= 1) {
    const message = chat.messages[i];
    const raw = String(message.role === "user" ? message.text ?? message.content ?? "" : message.content ?? "");
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
  const today = new Date(now).setHours(0, 0, 0, 0);
  const date = new Date(at);
  if (at >= today) return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (at >= today - DAY) return "Yest.";
  if (at >= today - 6 * DAY) return date.toLocaleDateString(undefined, { weekday: "short" });
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/* Matches titles first, then anything said in the conversation. Returns the
   matching chats with a short excerpt around the first hit in the text. */
export function searchChats(chats, query) {
  const needle = String(query).replace(/\s+/g, " ").trim().toLowerCase();
  if (!needle) return null;
  const results = [];
  for (const chat of chats) {
    if (chat.title.toLowerCase().includes(needle)) {
      results.push({ chat, excerpt: "" });
      continue;
    }
    for (const message of chat.messages) {
      const raw = String(message.text ?? message.content ?? "").replace(/\s+/g, " ");
      /* Text is searched as written ("my_variable", "C#") and with Markdown
         marks removed ("**bold**" finds "bold"); the excerpt comes from
         whichever matched. */
      const plain = raw
        .replace(/\]\([^)]*\)/g, "]")
        .replace(/[#*_`>[\]|]/g, "");
      const text = raw.toLowerCase().includes(needle) ? raw : plain;
      const at = text.toLowerCase().indexOf(needle);
      if (at < 0) continue;
      /* A narrow rail shows little, so the excerpt starts just before the hit */
      const from = Math.max(0, at - 12);
      results.push({
        chat,
        excerpt: `${from ? "…" : ""}${text.slice(from, at + needle.length + 48).trim()}…`,
      });
      break;
    }
  }
  return results;
}
