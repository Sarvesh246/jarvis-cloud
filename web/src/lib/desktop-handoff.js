const KEY = "vaelo-desktop-handoff";
const validProof = value => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
const validCallback = value => value && typeof value === "object" && !Array.isArray(value) &&
  Number.isInteger(value.port) && value.port >= 1024 && value.port <= 65535 &&
  validProof(value.state) && validProof(value.challenge);

export function readDesktopHandoff(storage, url, now = Date.now()) {
  try {
    // Accessing sessionStorage itself can throw when browser storage is denied.
    if (storage === undefined) storage = sessionStorage;
    if (url === undefined) url = new URL(location.href);
    if (url.searchParams.get("desktop") === "1") {
      const port = Number(url.searchParams.get("port"));
      const state = url.searchParams.get("state");
      const challenge = url.searchParams.get("challenge");
      if (!validCallback({ port, state, challenge }))
        throw new Error("Invalid desktop sign-in request.");
      storage.setItem(KEY, JSON.stringify({ port, state, challenge, at: now }));
      if (typeof history !== "undefined") history.replaceState(null, "", "/");
    }
    const pending = JSON.parse(storage.getItem(KEY) || "null");
    // Redirect-restored data needs the same callback checks as a fresh link.
    // In particular, a string port can turn the loopback authority into userinfo.
    if (!validCallback(pending) || !Number.isSafeInteger(pending.at) || pending.at < 0 ||
        !Number.isSafeInteger(now) || pending.at > now || now - pending.at > 300_000 ||
        (pending.started !== undefined && typeof pending.started !== "boolean")) {
      clearDesktopHandoff(storage);
      return null;
    }
    return pending;
  } catch { clearDesktopHandoff(storage); return null; }
}
export function clearDesktopHandoff(storage) {
  try {
    if (storage === undefined) storage = sessionStorage;
    storage.removeItem(KEY);
  } catch { /* Storage cleanup must not block startup, Cancel or the native callback. */ }
}
/* Remembers that this tab sent the person to Google for the handoff, so the
   fresh sign-in can count as their go-ahead when they come back. */
export function markDesktopHandoffStarted(pending, storage) {
  const started = { ...pending, started: true };
  try {
    if (storage === undefined) storage = sessionStorage;
    storage.setItem(KEY, JSON.stringify(started));
  } catch { /* the confirm button remains after a redirect */ }
  return started;
}
