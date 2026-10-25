// Share running replies between tabs of one account, without touching another
// account's recovery records. Selection stays in per-tab session storage.
export function replyRegistry(sub, storage, now = Date.now) {
  const key = `vaelo-live-replies:${sub || 'signed-out'}`;
  // Access to the storage property itself can throw in restricted browsers.
  const backing = () => storage === undefined ? globalThis.localStorage : storage;
  const read = () => {
    try {
      const value = JSON.parse(backing().getItem(key) || '{}');
      if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
      // Recovery sorts these records and dereferences their fields during App
      // effects. One damaged row must not prevent other replies from resuming.
      return Object.fromEntries(Object.entries(value).filter(([id, entry]) =>
        id && entry && typeof entry === 'object' && !Array.isArray(entry) &&
        typeof entry.chatId === 'string' && entry.chatId.length > 0 &&
        Number.isFinite(entry.at) && entry.at >= 0));
    } catch { return {}; }
  };
  const write = value => {
    try { backing().setItem(key, JSON.stringify(value)); } catch { /* offline backup is optional */ }
  };
  return {
    read,
    remember(id, chatId, run = id) {
      const live = read();
      const previous = Object.hasOwn(live, id) ? live[id] : undefined;
      // Older records omitted run; App replays those using the message ID.
      const previousRun = typeof previous?.run === 'string' ? previous.run : id;
      write({ ...live, [id]: { chatId, run, at: previous && previousRun === run ? previous.at : now() } });
    },
    forget(id) {
      const live = read();
      if (!Object.hasOwn(live, id)) return;
      delete live[id]; write(live);
    },
  };
}
