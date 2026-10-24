export function fitTitle(value, fits, suffix = '…') {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (fits(text)) return text;
  const words = text.split(' ');
  while (words.length) {
    words.pop();
    const candidate = words.join(' ').replace(/[,:;\-–—]+$/, '').trimEnd();
    if (candidate && fits(candidate + suffix)) return candidate + suffix;
  }
  return fits(suffix) ? suffix : '';
}

export function chatTitle(value, limit = 48) {
  const fitted = fitTitle(value, text => Array.from(text).length <= limit);
  return !fitted || fitted === '…' ? 'New conversation' : fitted;
}

export function displayChatTitle(chat) {
  const first = chat?.messages?.[0];
  const original = first?.text || first?.attachments?.[0]?.name || first?.content;
  if (typeof original === 'string' && original.length > 48 && chat.title === original.slice(0, 48)) return chatTitle(original);
  return chat?.title || 'New conversation';
}

// A replayed first-response event must belong to this reply and must never
// overwrite a manual rename, a branch, or a replacement first response.
export function withGeneratedTitle(chat, value, replyId) {
  if (chat.titleManual || typeof value !== 'string' || value.length > 120 || /[<>`*\u0000-\u001f]/u.test(value)) return chat;
  if (chat.messages.filter(message => message.role === 'user').length !== 1 ||
      chat.messages.find(message => message.role === 'assistant')?.id !== replyId) return chat;
  const title = value.replace(/\s+/g, ' ').trim();
  if (!title || Array.from(title).length > 48 || title.split(' ').length > 6) return chat;
  return title === chat.title ? chat : { ...chat, title };
}
