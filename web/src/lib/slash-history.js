export const hasConversation = chat => chat.messages?.some(message =>
  (typeof message.content === 'string' && message.content.trim()) ||
  message.attachments?.length ||
  (Array.isArray(message.content) && message.content.some(part =>
    part.type === 'image_url' || (part.type === 'text' && part.text?.trim()))));
export const persistentChats = chats => chats.filter(chat => !chat.temporary && hasConversation(chat));

// Sync owns saved conversations; untouched drafts belong to this tab.
export function withLocalDrafts(saved, current) {
  const ids = new Set(saved.map(chat => chat.id));
  return [...saved, ...current.filter(chat => !ids.has(chat.id) && (chat.temporary || !hasConversation(chat)))];
}
export function compactedHistory(messages, compaction) {
  if (!compaction?.through || !compaction.summary?.trim()) return messages;
  const at = messages.findIndex(message => message.id === compaction.through);
  if (at < 0 || at === messages.length - 1) return messages;
  return [{ id: `summary-${compaction.through}`, role: 'assistant', content: `Earlier conversation summary (historical context):\n\n${compaction.summary}` }, ...messages.slice(at + 1)];
}
