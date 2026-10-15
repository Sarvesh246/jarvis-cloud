import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { LIMITS, chatInput, clipReply as serverClip, streamChat } from "../server/chat.js";
import { probeBackend } from "../server/backend-readiness.js";
import { clipReply, fitHistory, wireMessage } from "../src/lib/attachments.js";

const conversationId = "123e4567-e89b-12d3-a456-426614174000";

test("a very long earlier reply no longer makes the next message invalid", () => {
  const program = "line of code\n".repeat(5000);
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
  res.write = (chunk) => (res.chunks.push(String(chunk)), true);
  res.end = () => {
    res.ended = true;
  };
  const req = new EventEmitter();
  const events = () =>
    res.chunks
      .join("")
      .split("\n\n")
      .filter((frame) => frame.startsWith("event:"))
      .map((frame) => {
        const [head, data] = frame.split("\n");
        return { name: head.slice(7), data: JSON.parse(data.slice(6)) };
      });
  return { req, res, events };
}

const cfg = { backend: "https://backend.example", apiKey: "k".repeat(40) };
const user = { sub: "owner", name: "Owner" };
const input = { conversationId, messages: [{ role: "user", content: "hi" }] };

test("a reply that outlasts the function says so and keeps what arrived", async () => {
  const { req, res, events } = fakeExchange();
  const request = async (url, options) => {
    if (url.endsWith("/health")) return Response.json({ status: "ok" });
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Part one"}}]}\n\n'));
        options.signal.addEventListener("abort", () => controller.error(options.signal.reason));
      },
    });
    return new Response(body, { status: 200 });
  };
  await streamChat(req, res, cfg, user, input, request, { timeLimitMs: 30 });
  assert.match(res.chunks.join(""), /Part one/);
  const error = events().find((e) => e.name === "jarvis.error");
  assert.equal(error.data.code, "time_limit");
  assert.match(error.data.message, /Continue/);
  assert.ok(res.ended);
});

test("waking is only announced when the server is actually asleep", async () => {
  const run = async (healthy) => {
    const { req, res, events } = fakeExchange();
    let probes = 0;
    const request = async (url) => {
      if (url.endsWith("/health"))
        return probes++ || healthy ? Response.json({ status: "ok" }) : new Response("", { status: 502 });
      if (url.endsWith("/")) return new Response("waking");
      return new Response('data: {"choices":[{"delta":{"content":"Hi"},"finish_reason":"stop"}]}\n\n');
    };
    await streamChat(req, res, cfg, user, input, request);
    return events().filter((e) => e.name === "jarvis.status").map((e) => e.data.message);
  };
  assert.ok(!(await run(true)).some((message) => /wak/i.test(message)));
  assert.ok((await run(false)).some((message) => /Waking/.test(message)));
});
