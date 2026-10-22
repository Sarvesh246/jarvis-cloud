// Share running replies between tabs of one account, without touching another
// account's recovery records. Selection stays in per-tab session storage.
export function replyRegistry(sub, storage = localStorage, now = Date.now) {
  const key = `vaelo-live-replies:${sub || 'signed-out'}`;
  const read = () => {
    try {
      const value = JSON.parse(storage.getItem(key) || '{}');
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch { return {}; }
  };
  const write = value => {
    try { storage.setItem(key, JSON.stringify(value)); } catch { /* offline backup is optional */ }
  };
  return {
    read,
    remember(id, chatId, run = id) {
      const previous = read()[id];
      write({ ...read(), [id]: { chatId, run, at: previous?.run === run ? previous.at : now() } });
    },
    forget(id) {
      const live = read();
      if (!(id in live)) return;
      delete live[id]; write(live);
    },
  };
}
