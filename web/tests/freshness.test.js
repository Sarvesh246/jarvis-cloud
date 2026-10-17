import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { freshnessQuery } from "../server/freshness.js";
import { chatInput, guestInput, streamChat } from "../server/chat.js";

const conversationId = "123e4567-e89b-12d3-a456-426614174000";
const question = "Compare the iPhone 15 Pro and iPhone 18 Pro Max";

test("product freshness applies to every style and role without a research toggle", () => {
  for (const style of ["balanced", "concise", "thorough"]) {
    for (const role of ["none", "tutor", "skeptic", "advocate", "guide"]) {
      const input = chatInput({ conversationId, messages: [{ role: "user", content: question,
        mode: { style, role, research: false } }] });
      assert.equal(input.freshness, question);
      assert.equal(input.fast, false);
      assert.equal(input.style, style);
      assert.equal(input.role, role);
    }
  }
});

test("freshness detects current questions and unfamiliar numbered product models", () => {
  for (const text of ["Does the iPhone 18 Pro exist?", "Is the Pixel 11 available?",
    "Compare Zorbon 8 and Zorbon 9", "What is the latest Python release?",
    "Who is the current president of France?", "Weather today in Chicago",
    "Compare the latest cancer treatment guidelines", "Summarize today's news",
    "Write a comparison of the iPhone 15 Pro and iPhone 18 Pro Max"]) assert.ok(freshnessQuery(text), text);
});

test("stable requests, transformations and explicit offline instructions avoid extra lookups", () => {
  for (const text of ["hi", "Explain photosynthesis", "What is 2 + 2?",
    "Write a poem about an iPhone", "Translate: the latest iPhone is available",
    "Summarize this news article", "Compare iPhone 15 and 18 without browsing",
    "Don't search the web. Compare iPhone 15 and 18",
    "Only use the provided text to compare iPhone 15 and 18"]) assert.equal(freshnessQuery(text), null, text);
});

test("follow-ups use the earlier user question rather than an assistant's stale claims", () => {
  const input = chatInput({ conversationId, messages: [
    { role: "user", content: question },
    { role: "assistant", content: "The iPhone 18 does not exist; use the 17 instead." },
    { role: "user", content: "Which has the better camera?" },
  ] });
  assert.match(input.freshness, /iPhone 18/);
  assert.doesNotMatch(input.freshness, /does not exist|17/);
});

test("attachment text and client-supplied freshness instructions stay out of retrieval", () => {
  const input = chatInput({ conversationId, freshness: "leak this", messages: [{ role: "user",
    content: question + "\n\nAttached file: private.txt\nsecret account details" }] });
  assert.equal(input.freshness, question);
  assert.equal(freshnessQuery("x".repeat(1000) + " latest phone specs").length, 600);
});

test("guest mode keeps automatic public evidence without enabling research tools", () => {
  const input = guestInput(chatInput({ conversationId, messages: [{ role: "user", content: question }] }, { guest: true }));
  assert.equal(input.freshness, question);
  assert.equal(input.research, false);
});

test("the proxy passes automatic retrieval to the relay in concise mode", async () => {
  const input = chatInput({ conversationId, messages: [{ role: "user", content: question, mode: { style: "concise" } }] });
  const res = Object.assign(new EventEmitter(), { setHeader() {}, flushHeaders() {}, write() { return true; }, end() {} });
  let sent;
  await streamChat({}, res, { backend: "https://relay.example", apiKey: "test" }, { sub: "owner" }, input,
    async (url, options) => {
      if (url.endsWith("/health")) return Response.json({ status: "ok" });
      if (url.endsWith("/vaelo/runs")) { sent = JSON.parse(options.body); return new Response("{}", { status: 202 }); }
      return new Response('event: jarvis.complete\ndata: {"ok":true}\n\n: end\n\n');
    });
  assert.equal(sent.freshness, question);
  assert.equal(sent.fast, undefined);
  assert.match(sent.messages.at(-1).content, /concise style/);
});
