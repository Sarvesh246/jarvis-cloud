import { base, relayHeaders } from "./relay-transport.js";

/* A conversation was saved: wake every listening device. Best effort and
   brief; a device that misses it still finds the change on its next check. */
export async function notifyFeed(cfg, user, request = fetch) {
  if (!cfg.backend.startsWith("https://") || !cfg.apiKey) return;
  try {
    const response = await request(`${base(cfg)}/vaelo/feed`, {
      method: "POST",
      signal: AbortSignal.timeout(1500),
      headers: relayHeaders(cfg, user),
      body: "{}",
    });
    await response.body?.cancel();
  } catch {
    /* the cloud is asleep or restarting; nobody is listening then */
  }
}
