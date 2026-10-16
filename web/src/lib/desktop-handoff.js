const KEY = "vaelo-desktop-handoff";
export function readDesktopHandoff(storage = sessionStorage, url = new URL(location.href), now = Date.now()) {
  try {
    if (url.searchParams.get("desktop") === "1") {
      const port = Number(url.searchParams.get("port"));
      const state = url.searchParams.get("state");
      const challenge = url.searchParams.get("challenge");
      if (!Number.isInteger(port) || port < 1024 || port > 65535 ||
          !/^[A-Za-z0-9_-]{43}$/.test(state || "") || !/^[A-Za-z0-9_-]{43}$/.test(challenge || ""))
        throw new Error("Invalid desktop sign-in request.");
      storage.setItem(KEY, JSON.stringify({ port, state, challenge, at: now }));
      if (typeof history !== "undefined") history.replaceState(null, "", "/");
    }
    const pending = JSON.parse(storage.getItem(KEY) || "null");
    if (!pending || now - pending.at > 300_000) { storage.removeItem(KEY); return null; }
    return pending;
  } catch { storage.removeItem(KEY); return null; }
}
export const clearDesktopHandoff = () => sessionStorage.removeItem(KEY);
/* Remembers that this tab sent the person to Google for the handoff, so the
   fresh sign-in can count as their go-ahead when they come back. */
export function markDesktopHandoffStarted(pending, storage = sessionStorage) {
  const started = { ...pending, started: true };
  try { storage.setItem(KEY, JSON.stringify(started)); } catch { /* the confirm button remains */ }
  return started;
}
