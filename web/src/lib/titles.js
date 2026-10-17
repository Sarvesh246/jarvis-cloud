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
