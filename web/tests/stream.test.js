import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readEvents } from "../src/stream.js";
import { chatInput, REPLY_FORMAT_GUIDANCE, RESPONSE_STANDARDS, streamChat } from "../server/chat.js";

test("SSE parser preserves split UTF-8, tool events and content across chunk boundaries", async () => {
  const text =
    'event: hermes.tool.progress\ndata: {"tool_name":"web_search"}\n\ndata: {"choices":[{"delta":{"content":"Hello café"}}]}\n\ndata: [DONE]\n\n';
  const bytes = new TextEncoder().encode(text);
  const body = new ReadableStream({
    start(controller) {
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    },
  });
  const events = [];
  await readEvents(body, (name, data) => events.push({ name, data }));
  assert.equal(events[0].name, "hermes.tool.progress");
  assert.equal(events[1].data.choices[0].delta.content, "Hello café");
});

test("proxy fixes the model, scopes memory and never places the backend key in the stream", async () => {
  const res = new EventEmitter();
  const output = [];
  Object.assign(res, {
    setHeader() {},
    flushHeaders() {},
    write(chunk) {
      output.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
      return true;
    },
    end() {},
  });
  let sent;
  await streamChat(
    {},
    res,
    { backend: "https://backend.example", apiKey: "private-test-key" },
    { sub: "owner", name: "Maya", email: "owner@gmail.com" },
    chatInput({
      conversationId: "c5ec5f03-1fd1-4f38-83df-b664bf78f998",
      runId: "0d9e8f7a-6b5c-4d3e-8f1a-2b3c4d5e6f70",
      messages: [{ role: "user", content: "hello vaelo" }],
      place: { lat: 41.88, lon: -87.63, city: 'Chicago', tz: 'America/Chicago' },
    }),
    async (url, options) => {
      if (url.endsWith("/health")) return Response.json({ status: "ok" });
      if (url.endsWith("/vaelo/runs")) {
        sent = { url, options };
        return new Response("{}", { status: 202 });
      }
      return new Response(
        'id: 0\ndata: {"choices":[{"delta":{"content":"Hi"}}]}\n\nid: 1\nevent: jarvis.complete\ndata: {"ok":true}\n\n: end\n\n',
      );
    },
  );
  assert.equal(sent.options.headers.Authorization, "Bearer private-test-key");
  assert.equal(sent.options.headers["X-Hermes-Session-Key"], "web:owner");
  assert.equal(JSON.parse(sent.options.body).id, "0d9e8f7a-6b5c-4d3e-8f1a-2b3c4d5e6f70");
  assert.equal(JSON.parse(sent.options.body).generate_title, true);
  assert.equal(JSON.parse(sent.options.body).no_weather_tools, true);
  assert.equal(JSON.parse(sent.options.body).place, undefined);
  assert.doesNotMatch(JSON.stringify(JSON.parse(sent.options.body).messages), /shared coordinates|41\.88|-87\.63/);
  const context = JSON.parse(sent.options.body).messages[0].content;
  assert.match(context, /"display_name":"Maya"/);
  const fastPrompt = JSON.parse(sent.options.body).fast;
  assert.doesNotMatch(fastPrompt, /weather|shared coordinates|41\.88|-87\.63/i);
  assert.ok(context.includes(RESPONSE_STANDARDS));
  assert.ok(fastPrompt.includes(RESPONSE_STANDARDS));
  assert.ok(fastPrompt.length <= 8000, "direct prompt fits the relay limit");
  assert.ok(fastPrompt.indexOf(REPLY_FORMAT_GUIDANCE) >= 0);
  assert.ok(fastPrompt.indexOf('"display_name":"Maya"') >
    fastPrompt.indexOf(REPLY_FORMAT_GUIDANCE) + REPLY_FORMAT_GUIDANCE.length);
  assert.doesNotMatch(context, /owner@gmail\.com/);
  assert.match(output.join(""), /jarvis.complete/);
  assert.doesNotMatch(output.join(""), /private-test-key/);
});

test("upstream failures produce a visible error without provider bodies or secrets", async () => {
  const res = new EventEmitter();
  const output = [];
  Object.assign(res, {
    setHeader() {},
    flushHeaders() {},
    write(chunk) {
      output.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
      return true;
    },
    end() {},
  });
  await streamChat(
    {},
    res,
    { backend: "https://backend.example", apiKey: "secret" },
    { sub: "owner" },
    { conversationId: "test", messages: [] },
    async (url) => url.endsWith("/health")
      ? Response.json({ status: "ok" })
      : new Response("sensitive error body", { status: 401 }),
  );
  assert.match(output.join(""), /jarvis.error/);
  assert.doesNotMatch(output.join(""), /sensitive error body/);
});
