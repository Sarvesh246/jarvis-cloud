/* "Keep conversations for N days". Removing a conversation is not local: the
   sync turns it into a deletion that every signed-in device applies and the
   cloud copy is erased, so this only ever names conversations to remove. It
   never touches the open conversation, pinned ones, one with a reply being
   written, or an empty one, and takes at most MAX_PER_PASS at a time so a
   wrong clock or setting cannot empty the library in one go. */
export const RETENTION_CHOICES = [30, 90, 365];
export const MAX_PER_PASS = 25;
const DAY = 24 * 60 * 60 * 1000;

export const validRetention = (days) => days === 0 || RETENTION_CHOICES.includes(days);

export function expiredChatIds(chats, days, { now, activeId = null, busyIds = [] } = {}) {
  if (!RETENTION_CHOICES.includes(days) || !Number.isFinite(now) || !Array.isArray(chats)) return [];
  const cutoff = now - days * DAY;
  const skip = new Set(busyIds);
  return chats
    .filter((chat) =>
      chat && typeof chat.id === "string" && Array.isArray(chat.messages) && chat.messages.length > 0 &&
      Number.isFinite(chat.updated) && chat.updated < cutoff &&
      !chat.pinned && chat.id !== activeId && !skip.has(chat.id) &&
      !chat.messages.some((message) => message?.running))
    .sort((a, b) => a.updated - b.updated)
    .slice(0, MAX_PER_PASS)
    .map((chat) => chat.id);
}
