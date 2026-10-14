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

/* "web_search" -> "Web search" */
export function humanizeTool(name = "") {
  const text = String(name).replace(/[_-]+/g, " ").trim();
  return text ? text[0].toUpperCase() + text.slice(1) : "A tool";
}

const DAY = 86_400_000;

/* Newest first, grouped by how long ago the conversation was touched. */
export function groupChats(chats, now = Date.now()) {
  const start = new Date(now).setHours(0, 0, 0, 0);
  const groups = [
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "Earlier", items: [] },
  ];
  [...chats]
    .sort((a, b) => (b.updated || 0) - (a.updated || 0))
    .forEach((chat) => {
      const at = chat.updated || 0;
      const bucket = at >= start ? 0 : at >= start - DAY ? 1 : 2;
      groups[bucket].items.push(chat);
    });
  return groups.filter((group) => group.items.length);
}

/* What the status chip says, in plain words. */
export function statusText({ phase, cloud, tool }) {
  if (phase === "working") return tool ? `Using ${tool.toLowerCase()}` : "Working";
  if (phase === "waking") return "Waking up";
  if (phase === "thinking") return "Thinking";
  if (phase === "speaking") return "Writing";
  if (phase === "concern") return "Something went wrong";
  if (cloud === "Unavailable") return "Offline";
  if (cloud === "Starting") return "Resting";
  return "Here";
}
