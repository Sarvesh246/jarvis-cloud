import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { LIMITS, chatInput, clipReply as serverClip, feedInput, followFeed, notifyFeed, resumeInput, streamChat } from "../server/chat.js";
import { probeBackend } from "../server/backend-readiness.js";
import { readEvents } from "../src/stream.js";
import { clipReply, fitHistory, wireMessage } from "../src/lib/attachments.js";

const conversationId = "123e4567-e89b-12d3-a456-426614174000";

test("a very long earlier reply no longer makes the next message invalid", () => {
  const program = "line of code\n".repeat(20000);
  const input = chatInput({
    conversationId,
    messages: [
      { role: "user", content: "Write the whole app." },
      { role: "assistant", content: program },
      { role: "user", content: "Now add tests." },
    ],
  });
  const reply = input.messages[1].content;
  assert.equal(reply.length, LIMITS.replyChars);
  assert.ok(reply.startsWith("line of code"));
  assert.match(reply, /omitted to save space/);
  assert.match(input.messages[2].content, /^Now add tests\./);
});

test("the page and the proxy clip a reply identically, so it is never clipped twice", () => {
  const long = "a".repeat(30000) + "END";
  const sent = wireMessage({ role: "assistant", content: long }).content;
  assert.equal(sent, clipReply(long));
  assert.equal(serverClip(sent), sent);
  assert.ok(sent.endsWith("END"));
});

test("a conversation with several long code replies still sends its recent turns", () => {
  const turns = Array.from({ length: 13 }, (_, i) =>
    wireMessage({ role: i % 2 ? "assistant" : "user", content: i % 2 ? "x".repeat(40000) : "next step" }),
  );
  const { messages } = fitHistory(turns);
  assert.ok(messages.length >= 6);
  assert.doesNotThrow(() => chatInput({ conversationId, messages }));
});

test("a sleeping, booting or slow server reads as not ready, never as an error", async () => {
  const answers = [
    () => new Response("<html>waking</html>", { status: 502 }),
    () => Response.json({ status: "setup_required" }),
    () => new Response("<html>loading</html>", { status: 200 }),
    () => Promise.reject(new TypeError("fetch failed")),
  ];
  for (const answer of answers)
    assert.equal(await probeBackend("https://backend.example", { request: answer }), false);
  assert.equal(
    await probeBackend("https://backend.example", { request: () => Response.json({ status: "ok" }) }),
    true,
  );
});

function fakeExchange() {
  const res = new EventEmitter();
  res.chunks = [];
  res.destroyed = false;
  res.setHeader = () => {};
  res.write = (chunk) => (res.chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString()), true);
  res.end = () => {
    res.ended = true;
  };
  const req = new EventEmitter();
  const events = () =>
    res.chunks
      .join("")
      .split("\n\n")
      .map((frame) => frame.split("\n").filter((line) => !line.startsWith("id:")))
      .filter((lines) => lines[0]?.startsWith("event:"))
      .map(([head, data]) => ({ name: head.slice(7), data: JSON.parse(data.slice(6)) }));
  return { req, res, events };
}

const cfg = { backend: "https://backend.example", apiKey: "k".repeat(40) };
const user = { sub: "owner", name: "Owner" };
const runId = "9f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f";
const input = { conversationId, runId, messages: [{ role: "user", content: "hi" }] };

/* A stand-in for the relay in front of Hermes: it accepts runs and serves
   their numbered frames, ending with ": end" once the run is over. */
function fakeRelay({ frames = ['id: 0\nevent: jarvis.complete\ndata: {"ok":true}'], end = true, health = () => true, start = 202, events } = {}) {
  const calls = [];
  const request = async (url, options = {}) => {
    calls.push({ url, method: options.method || "GET", options });
    if (url.endsWith("/health")) return health() ? Response.json({ status: "ok" }) : new Response("", { status: 502 });
    if (url.endsWith("/")) return new Response("waking");
    if (url.endsWith("/vaelo/runs")) return new Response(JSON.stringify({ run_id: runId }), { status: start });
    if (url.includes("/events")) {
      if (events) return events(url, options);
      return new Response(frames.map((frame) => `${frame}\n\n`).join("") + (end ? ": end\n\n" : ""));
    }
    return new Response("", { status: 404 });
  };
  return { request, calls };
}

test("a reply that outlasts the function tells the page to pick it back up", async () => {
  const { req, res, events } = fakeExchange();
  const { request } = fakeRelay({
    events: (url, options) =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('id: 0\ndata: {"choices":[{"delta":{"content":"Part one"}}]}\n\n'));
            options.signal.addEventListener("abort", () => controller.error(options.signal.reason));
          },
        }),
      ),
  });
  await streamChat(req, res, cfg, user, input, request, { followMs: 50 });
  assert.match(res.chunks.join(""), /Part one/);
  const names = events().map((e) => e.name);
  assert.equal(names.at(-1), "jarvis.resume");
  assert.ok(!names.includes("jarvis.error"));
  assert.ok(res.ended);
});

test("waking is only announced when the server is actually asleep", async () => {
  const run = async (healthy) => {
    const { req, res, events } = fakeExchange();
    let probes = 0;
    const { request } = fakeRelay({ health: () => probes++ || healthy });
    await streamChat(req, res, cfg, user, input, request);
    return events().filter((e) => e.name === "jarvis.status").map((e) => e.data.message);
  };
  assert.ok(!(await run(true)).some((message) => /wak/i.test(message)));
  assert.ok((await run(false)).some((message) => /Waking/.test(message)));
});

test("a reply is started on the relay under its own id, then followed from the start", async () => {
  const { req, res, events } = fakeExchange();
  const { request, calls } = fakeRelay({
    frames: ['id: 0\ndata: {"choices":[{"delta":{"content":"Hello"}}]}', 'id: 1\nevent: jarvis.complete\ndata: {"ok":true}'],
  });
  await streamChat(req, res, cfg, user, input, request);
  const start = calls.find((call) => call.url.endsWith("/vaelo/runs"));
  assert.equal(JSON.parse(start.options.body).id, runId);
  assert.ok(calls.some((call) => call.url.endsWith(`/vaelo/runs/${runId}/events?after=-1`)));
  assert.match(res.chunks.join(""), /id: 0\n/);
  assert.equal(events().at(-1).name, "jarvis.complete");
});

test("picking a reply back up never starts a new run", async () => {
  const { req, res } = fakeExchange();
  const { request, calls } = fakeRelay();
  await streamChat(req, res, cfg, user, { runId, after: 41 }, request);
  assert.ok(!calls.some((call) => call.url.endsWith("/vaelo/runs")));
  assert.ok(!calls.some((call) => call.url.endsWith("/health")));
  assert.ok(calls.some((call) => call.url.endsWith("/events?after=41")));
});

test("the page leaving never stops the reply", async () => {
  const { req, res } = fakeExchange();
  const { request, calls } = fakeRelay({
    events: (url, options) =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(": open\n\n"));
            options.signal.addEventListener("abort", () => controller.error(options.signal.reason));
          },
        }),
      ),
  });
  const done = streamChat(req, res, cfg, user, input, request);
  await new Promise((resolve) => setTimeout(resolve, 20));
  res.emit("close");
  await done;
  assert.ok(!calls.some((call) => call.url.includes("/stop")));
});

test("a reply the relay no longer has is reported, not waited on", async () => {
  const { req, res, events } = fakeExchange();
  const { request } = fakeRelay({ events: () => new Response("", { status: 404 }) });
  await streamChat(req, res, cfg, user, { runId, after: 3 }, request);
  assert.equal(events().at(-1).data.code, "run_missing");
});

test("a relay connection that breaks mid-reply sends the page back for the rest", async () => {
  const { req, res, events } = fakeExchange();
  const { request } = fakeRelay({ frames: ['id: 0\ndata: {"choices":[{"delta":{"content":"Partial"}}]}'], end: false });
  await streamChat(req, res, cfg, user, input, request);
  assert.match(res.chunks.join(""), /Partial/);
  assert.equal(events().at(-1).name, "jarvis.resume");
});

test("a relay connection cut partway through a frame never sends half of it", async () => {
  const { req, res } = fakeExchange();
  const whole = 'id: 0\ndata: {"choices":[{"delta":{"content":"Kept"}}]}\n\n';
  const half = 'id: 1\ndata: {"choices":[{"delta":{"con';
  const { request } = fakeRelay({
    events: () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(whole + half));
            setTimeout(() => controller.error(new Error("connection reset")), 5);
          },
        }),
      ),
  });
  await streamChat(req, res, cfg, user, { runId, after: -1 }, request);
  const seen = [];
  await readEvents(new Response(res.chunks.join("")).body, (name, data, id) => seen.push({ name, id }));
  // The half frame is left for the next request, which asks after frame 0.
  assert.deepEqual(seen, [
    { name: "message", id: "0" },
    { name: "jarvis.resume", id: undefined },
  ]);
});

test("resuming takes a run id and a position, nothing else", () => {
  assert.deepEqual(resumeInput({ run: runId, after: "12" }), { runId, after: 12 });
  assert.deepEqual(resumeInput({ run: runId }), { runId, after: -1 });
  assert.throws(() => resumeInput({ run: "../../etc", after: "1" }), /resumed/);
  assert.throws(() => resumeInput({ run: runId, after: "-5" }), /resumed/);
});

test("everyday replies ask for brief thinking; research and thorough keep full depth", async () => {
  const sent = async (mode) => {
    const { req, res } = fakeExchange();
    const { request, calls } = fakeRelay();
    await streamChat(req, res, cfg, user, { ...input, ...mode }, request);
    return JSON.parse(calls.find((call) => call.url.endsWith("/vaelo/runs")).options.body).model_options;
  };
  assert.deepEqual(await sent({ style: "balanced", research: false }), { reasoning_effort: "low" });
  assert.deepEqual(await sent({ style: "concise", research: false }), { reasoning_effort: "low" });
  assert.equal(await sent({ style: "thorough", research: false }), undefined);
  assert.equal(await sent({ style: "balanced", research: true }), undefined);
  // roles that weigh evidence think fully; teaching and step-by-step stay quick
  assert.equal(await sent({ style: "balanced", research: false, role: "skeptic" }), undefined);
  assert.equal(await sent({ style: "balanced", research: false, role: "advocate" }), undefined);
  assert.deepEqual(await sent({ style: "balanced", research: false, role: "tutor" }), { reasoning_effort: "low" });
  assert.deepEqual(await sent({ style: "balanced", research: false, role: "guide" }), { reasoning_effort: "low" });
});

test("a backend that just answered is not health-checked again before the next message", async () => {
  const { request, calls } = fakeRelay();
  for (let i = 0; i < 3; i += 1) {
    const { req, res, events } = fakeExchange();
    await streamChat(req, res, cfg, user, input, request);
    assert.equal(events().at(-1).name, "jarvis.complete");
  }
  assert.equal(calls.filter((call) => call.url.endsWith("/health")).length, 1);
});

test("after a failed start the backend is checked again", async () => {
  let starts = 0;
  const relay = fakeRelay();
  const request = async (url, options) => {
    if (url.endsWith("/vaelo/runs") && starts++ === 0) return new Response("", { status: 503 });
    return relay.request(url, options);
  };
  const first = fakeExchange();
  await streamChat(first.req, first.res, cfg, user, input, request);
  assert.equal(first.events().at(-1).name, "jarvis.error");
  const second = fakeExchange();
  await streamChat(second.req, second.res, cfg, user, input, request);
  assert.equal(second.events().at(-1).name, "jarvis.complete");
  assert.equal(relay.calls.filter((call) => call.url.endsWith("/health")).length, 2);
});

test("a reply is named by the page's own id, or given one by older pages", () => {
  const base = { conversationId, messages: [{ role: "user", content: "hi" }] };
  assert.equal(chatInput({ ...base, runId }).runId, runId);
  assert.match(chatInput(base).runId, /^[a-f0-9-]{36}$/);
  assert.notEqual(chatInput({ ...base, runId: "not-a-uuid" }).runId, "not-a-uuid");
});

test("devices listen for account changes through the relay, as the signed-in person", async () => {
  const calls = [];
  const request = async (url, options = {}) => {
    calls.push({ url, method: options.method || "GET", headers: options.headers });
    if (options.method === "POST") return Response.json({ ok: true });
    return new Response('event: feed\ndata: {"seq": 4}\n\n: end\n\n', {
      headers: { "Content-Type": "text/event-stream" },
    });
  };
  const { req, res } = fakeExchange();
  await followFeed(req, res, cfg, user, feedInput({ after: "3" }), request);
  assert.equal(calls[0].url, "https://backend.example/vaelo/feed?after=3");
  assert.equal(calls[0].headers["X-Hermes-Session-Key"], "web:owner");
  assert.match(res.chunks.join(""), /"seq": 4/);
  assert.equal(res.ended, true);
  await notifyFeed(cfg, user, request);
  assert.equal(calls[1].method, "POST");
  // A sleeping cloud never fails a save.
  await notifyFeed(cfg, user, async () => { throw new TypeError("fetch failed"); });
  // Nor does it hold a listening device: it is told to check storage instead.
  await assert.rejects(
    followFeed(fakeExchange().req, fakeExchange().res, cfg, user, -1, async () => new Response("", { status: 502 })),
    { status: 503 },
  );
  assert.throws(() => feedInput({ after: "soon" }), { status: 400 });
});
