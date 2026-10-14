import { setTimeout as delay } from "node:timers/promises";

// Render's free instance can return an edge 502 while asleep or starting.
// Wake it with a public GET, then wait for Hermes; never retry a chat POST.
export async function waitForBackend(backend, {
  signal,
  request = fetch,
  maxWaitMs = 120000,
  pause = delay,
} = {}) {
  const base = backend.replace(/\/$/, "");
  const deadline = Date.now() + maxWaitMs;
  let woke = false;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    const probeSignal = () => AbortSignal.any([
      ...(signal ? [signal] : []),
      AbortSignal.timeout(Math.max(1, Math.min(15000, deadline - Date.now()))),
    ]);
    try {
      const response = await request(`${base}/health`, { signal: probeSignal() });
      if (response.ok && (await response.json()).status === "ok") return;
    } catch {
      signal?.throwIfAborted();
    }
    if (!woke && Date.now() < deadline) {
      woke = true;
      try {
        const response = await request(`${base}/`, {
          headers: { Accept: "text/html" }, signal: probeSignal(),
        });
        await response.body?.cancel();
      } catch {
        signal?.throwIfAborted();
      }
    }
    await pause(Math.min(2500, Math.max(0, deadline - Date.now())), undefined, { signal });
  }
  throw new Error("The cloud server is still starting. Please try again in a moment.");
}
