import { setTimeout as delay } from "node:timers/promises";

/* One health check. Render's edge answers a sleeping service with a 502 or
   an HTML loading page, and a booting Hermes with setup JSON, so anything but
   {"status":"ok"} is "not ready yet", never an outage on its own. */
export async function probeBackend(backend, { signal, request = fetch, timeoutMs = 8000 } = {}) {
  const base = backend.replace(/\/$/, "");
  try {
    const response = await request(`${base}/health`, {
      signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(timeoutMs)]),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return false;
    }
    return (await response.json()).status === "ok";
  } catch {
    signal?.throwIfAborted();
    return false;
  }
}

/* A plain page GET is what makes Render start a sleeping free instance. */
export async function wakeBackend(backend, { signal, request = fetch, timeoutMs = 10000 } = {}) {
  try {
    const response = await request(`${backend.replace(/\/$/, "")}/`, {
      headers: { Accept: "text/html" },
      signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(timeoutMs)]),
    });
    await response.body?.cancel();
  } catch {
    signal?.throwIfAborted();
  }
}

/* A warm function remembers that the backend answered moments ago, so the
   next message goes straight to it instead of paying for another health
   round trip first. A free instance can't fall asleep within this window
   (Render waits 15 idle minutes). Kept per transport, so a test's fake
   fetch never borrows the real one's answer. */
const TRUST_HEALTHY_MS = 45000;
const healthy = new WeakMap();

export function noteHealthy(backend, request = fetch) {
  if (!healthy.has(request)) healthy.set(request, new Map());
  healthy.get(request).set(backend.replace(/\/$/, ""), Date.now());
}

export function forgetHealthy(backend, request = fetch) {
  healthy.get(request)?.delete(backend.replace(/\/$/, ""));
}

function recentlyHealthy(backend, request) {
  const at = healthy.get(request)?.get(backend.replace(/\/$/, ""));
  return at !== undefined && Date.now() - at < TRUST_HEALTHY_MS;
}

// Render's free instance can return an edge 502 while asleep or starting.
// Wake it with a public GET, then wait for Hermes; never retry a chat POST.
export async function waitForBackend(backend, {
  signal,
  request = fetch,
  maxWaitMs = 150000,
  pause = delay,
  onWaking = () => {},
} = {}) {
  const base = backend.replace(/\/$/, "");
  signal?.throwIfAborted();
  if (recentlyHealthy(base, request)) return;
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
      if (response.ok && (await response.json()).status === "ok") {
        noteHealthy(base, request);
        return;
      }
      if (!response.ok) await response.body?.cancel();
    } catch {
      signal?.throwIfAborted();
    }
    if (!woke && Date.now() < deadline) {
      woke = true;
      onWaking();
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
