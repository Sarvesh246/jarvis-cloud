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

/* Matches titles first, then anything said in the conversation. Returns the
   matching chats with a short excerpt around the first hit in the text. */
export function searchChats(chats, query) {
  const needle = String(query).trim().toLowerCase();
  if (!needle) return null;
  const results = [];
  for (const chat of chats) {
    if (chat.title.toLowerCase().includes(needle)) {
      results.push({ chat, excerpt: "" });
      continue;
    }
    for (const message of chat.messages) {
      const text = String(message.text ?? message.content ?? "")
        .replace(/\]\([^)]*\)/g, "]")
        .replace(/[#*_`>[\]|]/g, "")
        .replace(/\s+/g, " ");
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
