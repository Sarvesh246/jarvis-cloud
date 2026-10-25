/* Only the composer needs every character; the welcome mark only observes
   whether there are words. Typing never walks the history/drawer. Writes are synchronous:
   Send, quotes and conversation switches always read the very latest edit,
   even before React paints it. This store belongs to one mounted App. */
export function createComposerDraft() {
  let text = '';
  let hasText = false;
  const listeners = new Set();
  return {
    getSnapshot: () => text,
    hasText: () => hasText,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(value) {
      const next = typeof value === 'function' ? value(text) : value;
      if (next === text) return;
      text = next;
      hasText = Boolean(text.trim());
      listeners.forEach(listener => listener());
    },
  };
}
