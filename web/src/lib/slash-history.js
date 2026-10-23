export const persistentChats = chats => chats.filter(chat => !chat.temporary);
export function compactedHistory(messages, compaction) {
  if (!compaction?.through || !compaction.summary?.trim()) return messages;
  const at = messages.findIndex(message => message.id === compaction.through);
  if (at < 0 || at === messages.length - 1) return messages;
  return [{ id: `summary-${compaction.through}`, role: 'assistant', content: `Earlier conversation summary (historical context):\n\n${compaction.summary}` }, ...messages.slice(at + 1)];
}
