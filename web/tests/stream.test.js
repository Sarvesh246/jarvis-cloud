import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readEvents } from "../src/stream.js";
import { streamChat } from "../server/chat.js";

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
      output.push(chunk.toString());
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
    {
      conversationId: "c5ec5f03-1fd1-4f38-83df-b664bf78f998",
      messages: [{ role: "user", content: "Hello" }],
    },
    async (url, options) => {
      sent = { url, options };
      return new Response(
        'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: [DONE]\n\n',
      );
    },
  );
  assert.equal(sent.options.headers.Authorization, "Bearer private-test-key");
  assert.equal(sent.options.headers["X-Hermes-Session-Key"], "web:owner");
  assert.equal(JSON.parse(sent.options.body).model, "jarvis");
  const context = JSON.parse(sent.options.body).messages[0].content;
  assert.match(context, /"display_name":"Maya"/);
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
      output.push(chunk.toString());
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
    async () => new Response("sensitive error body", { status: 401 }),
  );
  assert.match(output.join(""), /jarvis.error/);
  assert.doesNotMatch(output.join(""), /sensitive error body/);
});
