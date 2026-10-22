import { setTimeout as delay } from "node:timers/promises";
import { performance } from "node:perf_hooks";

// Health is a small status document, even when the edge returns a loading
// page. Bound actual bytes and release the stream before another probe.
const HEALTH_BYTES = 16 * 1024;
async function statusDocument(response, signal) {
  let reader;
  try {
    signal.throwIfAborted();
    if (!response.ok || !response.body) return null;
    reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > HEALTH_BYTES) return null;
      chunks.push(value);
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
    return JSON.parse(text);
  } finally {
    try { await (reader ? reader.cancel() : response.body?.cancel()); } catch {}
    reader?.releaseLock();
  }
}

async function healthReady(response,signal) {
  return (await statusDocument(response,signal))?.status==='ok';
}

// Explicit diagnostic reads only; never adds a probe to chat generation.
export async function probeCapabilities(backend,key,{request=fetch,timeoutMs=2500}={}) {
  try {
    const signal=AbortSignal.timeout(timeoutMs);
    const response=await request(`${backend.replace(/\/$/,'')}/vaelo/capabilities`,{
      headers:{Authorization:`Bearer ${key}`,'X-Hermes-Session-Key':'web:release-diagnostics'},signal});
    const value=await statusDocument(response,signal);
    if(!value || !/^[a-f0-9]{40}$/.test(value.revision||'')) return null;
    return {backend_revision:value.revision,
      backend_protocol:Number.isInteger(value.protocol)&&value.protocol>=1&&value.protocol<=100?value.protocol:null};
  } catch {return null;}
}

/* One health check. Render's edge answers a sleeping service with a 502 or
   an HTML loading page, and a booting Hermes with setup JSON, so anything but
   {"status":"ok"} is "not ready yet", never an outage on its own. */
export async function probeBackend(backend, { signal, request = fetch, timeoutMs = 8000 } = {}) {
  const base = backend.replace(/\/$/, "");
  signal?.throwIfAborted();
  try {
    const requestSignal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(timeoutMs)]);
    const response = await request(`${base}/health`, {
      signal: requestSignal,
    });
    const ready = await healthReady(response, requestSignal);
    requestSignal.throwIfAborted();
    return ready;
  } catch {
    signal?.throwIfAborted();
    return false;
  }
}

/* A plain page GET is what makes Render start a sleeping free instance. */
export async function wakeBackend(backend, { signal, request = fetch, timeoutMs = 10000 } = {}) {
  signal?.throwIfAborted();
  try {
    const response = await request(`${backend.replace(/\/$/, "")}/`, {
      headers: { Accept: "text/html" },
      signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(timeoutMs)]),
    });
    await response.body?.cancel();
    signal?.throwIfAborted();
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
  const age = Date.now() - at;
  return age >= 0 && age < TRUST_HEALTHY_MS;
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
  // A corrected system clock must not prolong or prematurely end warm-up.
  const deadline = performance.now() + maxWaitMs;
  let woke = false;
  while (performance.now() < deadline) {
    signal?.throwIfAborted();
    const probeSignal = () => AbortSignal.any([
      ...(signal ? [signal] : []),
      AbortSignal.timeout(Math.max(1, Math.ceil(Math.min(15000, deadline - performance.now())))),
    ]);
    try {
      const requestSignal = probeSignal();
      const response = await request(`${base}/health`, { signal: requestSignal });
      const ready = await healthReady(response, requestSignal);
      requestSignal.throwIfAborted();
      if (ready) {
        noteHealthy(base, request);
        return;
      }
    } catch {
      signal?.throwIfAborted();
    }
    if (!woke && performance.now() < deadline) {
      woke = true;
      onWaking();
      try {
        const response = await request(`${base}/`, {
          headers: { Accept: "text/html" }, signal: probeSignal(),
        });
        await response.body?.cancel();
        signal?.throwIfAborted();
      } catch {
        signal?.throwIfAborted();
      }
    }
    await pause(Math.min(2500, Math.max(0, deadline - performance.now())), undefined, { signal });
  }
  throw new Error("The cloud server is still starting. Please try again in a moment.");
}
