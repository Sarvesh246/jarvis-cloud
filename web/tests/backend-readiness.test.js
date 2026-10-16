import test from "node:test";
import assert from "node:assert/strict";
import { waitForBackend } from "../server/backend-readiness.js";

test("cold-start edge failures wake the service once and only use GET requests", async () => {
  const calls = [];
  let probes = 0;
  await waitForBackend("https://backend.example/", {
    pause: async () => {},
    request: async (url, options) => {
      calls.push({ url, method: options.method || "GET" });
      if (url.endsWith("/health")) {
        probes++;
        return probes < 3 ? new Response("Render unavailable", { status: 502 }) : Response.json({ status: "ok" });
      }
      return new Response("Application loading");
    },
  });
  assert.equal(probes, 3);
  assert.equal(calls.filter(c => c.url === "https://backend.example/").length, 1);
  assert.ok(calls.every(c => c.method === "GET"));
});

test("a stopped request cancels warm-up before any further probe", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(waitForBackend("https://backend.example", {
    signal: controller.signal,
    request: async () => assert.fail("aborted warm-up must not make a request"),
  }), { name: "AbortError" });
});

test("an unavailable service has a bounded wait", async () => {
  await assert.rejects(waitForBackend("https://backend.example", {
    maxWaitMs: 0,
    request: async () => assert.fail("expired deadline must not make a request"),
  }), /still starting/);
});

test("cold-start error response bodies are cancelled before probing again", async () => {
  let cancelled = 0;
  let probes = 0;
  await waitForBackend("https://cleanup.example", {
    pause: async () => {},
    request: async (url) => {
      if (!url.endsWith("/health")) return new Response("Loading");
      if (++probes === 3) return Response.json({ status: "ok" });
      return new Response(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode("Edge error")); },
        cancel() { cancelled++; },
      }), { status: 502 });
    },
  });
  assert.equal(cancelled, 2);
});
