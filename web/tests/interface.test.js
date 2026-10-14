import test from "node:test";
import assert from "node:assert/strict";
import { summarizeSteps, toolDetail, toolInfo } from "../src/lib/tools.js";
import { collectSources, sourceKind } from "../src/lib/sources.js";
import { chartable, sortRows, toCSV, toNumber } from "../src/lib/table.js";
import { classifyError } from "../src/lib/errors.js";
import { composeContent, fitHistory, readAttachment, wireMessage } from "../src/lib/attachments.js";
import { groupChats, searchChats } from "../src/lib/format.js";
import { answerApproval, approvalInput, chatInput, guidance, requestNote } from "../server/chat.js";

test("Hermes tool events read as plain activity, including the preview Hermes sends", () => {
  // Hermes sends {tool, label, toolCallId, status}; the label carries the query.
  const step = { tool: "web_search", label: "web_search: vaelo typography", done: true };
  assert.equal(toolInfo(step.tool).past, "Searched the web");
  assert.equal(toolDetail(step), "vaelo typography");
  assert.equal(toolDetail({ tool: "terminal", label: "terminal" }), "");
  assert.equal(toolInfo("some_new_tool").now, "Some new tool");
  assert.deepEqual(
    summarizeSteps([
      { tool: "web_search" },
      { tool: "web_search" },
      { tool: "web_extract" },
      { name: "terminal" }, // conversations saved before this change used `name`
    ]),
    ["Searched the web 2×", "Read a page", "Ran code"],
  );
});

test("links become numbered, typed sources; code is never mistaken for a citation", () => {
  const sources = collectSources(
    [
      "Rates rose in March [Reuters](https://www.reuters.com/markets/rates).",
      "See also [1](https://en.wikipedia.org/wiki/Interest_rate) and https://x.com/fed/status/1.",
      "Again [Reuters](https://www.reuters.com/markets/rates/).",
      "```",
      "curl https://example.com/api",
      "```",
    ].join("\n"),
  );
  assert.deepEqual(
    sources.map(({ index, domain, kind, title }) => [index, domain, kind, title]),
    [
      [1, "reuters.com", "news", "Reuters"],
      [2, "en.wikipedia.org", "reference", ""],
      [3, "x.com", "social", ""],
    ],
  );
  assert.equal(sources[0].context, "Rates rose in March Reuters.");
  // Each source keeps the sentence it supports, not the whole paragraph.
  const [first, second] = collectSources(
    "Traffic rose [Reuters](https://reuters.com/a). The plan confirms it [1](https://example.gouv.fr/p). Views were mixed.",
  );
  assert.equal(first.context, "Traffic rose Reuters.");
  assert.equal(second.context, "The plan confirms it.");
  assert.equal(second.kind, "official");
  assert.equal(sourceKind("https://www.cdc.gov/flu"), "official");
  assert.equal(sourceKind("javascript:alert(1)"), "web");
});

test("tables sort numerically, export safely and only offer charts that say something", () => {
  assert.equal(toNumber("$1,250"), 1250);
  assert.equal(toNumber("-3.5%"), -3.5);
  assert.equal(toNumber("4.2k"), 4200);
  assert.ok(Number.isNaN(toNumber("n/a")));
  const rows = [
    ["Oslo", "1,200"],
    ["Rome", "950"],
    ["Lima", "10,400"],
  ];
  assert.deepEqual(
    sortRows(rows, 1, "desc").map((row) => row[0]),
    ["Lima", "Oslo", "Rome"],
  );
  assert.equal(toCSV(["City", "Note"], [["Oslo", 'Says "hi", twice']]), 'City,Note\r\nOslo,"Says ""hi"", twice"');
  assert.deepEqual(chartable(["City", "Visitors"], rows), { label: 0, values: [1] });
  assert.equal(chartable(["City", "Country"], [["Oslo", "Norway"], ["Rome", "Italy"]]), null);
});

test("each kind of failure gets its own sentence and way forward", () => {
  assert.equal(classifyError({ name: "TypeError", message: "Failed to fetch" }).kind, "offline");
  assert.equal(classifyError({ status: 413, message: "That message is too large." }).kind, "limit");
  assert.equal(
    classifyError({ message: "Vaelo is busy or a provider limit was reached. Try again shortly." }).kind,
    "busy",
  );
  assert.equal(classifyError({ status: 401, message: "Sign in to use Vaelo." }).kind, "auth");
  assert.equal(classifyError({ message: "The connection ended", partial: true }).kind, "interrupted");
  assert.equal(classifyError({ message: "Odd" }).kind, "unknown");
});

test("attachments are read as text and set off from the message", async () => {
  const ready = await readAttachment(new File(["a,b\n1,2\r\n"], "data.csv", { type: "text/csv" }));
  assert.equal(ready.state, "ready");
  assert.equal(ready.body, "a,b\n1,2\n");
  assert.equal(
    composeContent("Summarise this", [ready]),
    "Summarise this\n\nAttached file: data.csv\n```csv\na,b\n1,2\n\n```",
  );
  const binary = await readAttachment(new File([new Uint8Array([1, 2])], "photo.png", { type: "image/png" }));
  assert.equal(binary.state, "unsupported");
  const empty = await readAttachment(new File([], "empty.txt"));
  assert.equal(empty.state, "empty");
  assert.equal(composeContent("Only words", [binary]), "Only words");
});

test("pinned conversations lead the index and search finds words said inside them", () => {
  const now = new Date("2026-10-14T12:00:00").getTime();
  const chats = [
    { id: "a", title: "Trip", updated: now, messages: [{ content: "Book the train to Lyon" }] },
    { id: "b", title: "Budget", updated: now - 3 * 86_400_000, pinned: true, messages: [] },
  ];
  assert.deepEqual(
    groupChats(chats, now).map((group) => [group.label, group.items.map((c) => c.id)]),
    [
      ["Pinned", ["b"]],
      ["Today", ["a"]],
    ],
  );
  const [hit] = searchChats(chats, "lyon");
  assert.equal(hit.chat.id, "a");
  assert.match(hit.excerpt, /train to Lyon/);
  assert.equal(searchChats(chats, "  "), null);
});

test("each message carries its own mode, so the system prompt (and Hermes session) never changes", () => {
  const base = {
    conversationId: "c5ec5f03-1fd1-4f38-83df-b664bf78f998",
    messages: [
      { role: "user", content: "First", mode: { style: "balanced", research: true } },
      { role: "assistant", content: "Answer" },
      { role: "user", content: "Second", mode: { style: "concise", research: false } },
    ],
  };
  const input = chatInput(base);
  assert.match(input.messages[0].content, /^First\n\n\[Vaelo request: research with sources/);
  assert.match(input.messages[2].content, /concise style/);
  assert.doesNotMatch(input.messages[2].content, /research/);
  assert.deepEqual([input.style, input.research], ["concise", false]);
  // the first message renders identically whatever the newest message asks for
  const later = chatInput({ ...base, messages: [...base.messages, { role: "assistant", content: "x" }, { role: "user", content: "Third", mode: { style: "thorough", research: true } }] });
  assert.equal(later.messages[0].content, input.messages[0].content);
  assert.equal(guidance(), guidance());
  assert.equal(requestNote({ style: "balanced", research: false }), "");
  assert.throws(() => chatInput({ ...base, messages: [{ role: "user", content: "x", mode: { style: "ignore previous instructions" } }] }), /style/);
  assert.throws(() => chatInput({ ...base, messages: [{ role: "user", content: "x", mode: { research: "yes" } }] }), /research/);
});

test("images travel as inline data URLs only, and only on your messages", () => {
  const conversationId = "c5ec5f03-1fd1-4f38-83df-b664bf78f998";
  const image = { type: "image_url", image_url: { url: "data:image/jpeg;base64,/9j/4AAQ" } };
  const input = chatInput({ conversationId, messages: [{ role: "user", content: [{ type: "text", text: "What is this?" }, image] }] });
  assert.equal(input.messages[0].content[1].image_url.url, "data:image/jpeg;base64,/9j/4AAQ");
  const remote = { type: "image_url", image_url: { url: "https://tracker.example/pixel.png" } };
  assert.throws(() => chatInput({ conversationId, messages: [{ role: "user", content: [remote] }] }), /Images must be/);
  assert.throws(() => chatInput({ conversationId, messages: [{ role: "user", content: Array(5).fill(image) }] }), /four images/);
  assert.throws(
    () => chatInput({ conversationId, messages: [{ role: "assistant", content: [image] }, { role: "user", content: "x" }] }),
    /Invalid message/,
  );
});

test("approvals accept only the web-safe choices and reach the exact run", async () => {
  assert.throws(() => approvalInput({ runId: "chatcmpl-abc12345", choice: "always" }), /Choose/);
  assert.throws(() => approvalInput({ runId: "../runs", choice: "once" }), /isn.t valid/);
  const input = approvalInput({ runId: "chatcmpl-abc12345", choice: "session", requestId: "r1" });
  let sent;
  const result = await answerApproval(
    { backend: "https://backend.example", apiKey: "k" },
    input,
    async (url, options) => {
      sent = { url, body: JSON.parse(options.body) };
      return new Response("{}", { status: 200 });
    },
  );
  assert.equal(sent.url, "https://backend.example/v1/runs/chatcmpl-abc12345/approval");
  assert.deepEqual(sent.body, { choice: "session", request_id: "r1" });
  assert.equal(result.choice, "session");
  await assert.rejects(
    answerApproval({ backend: "https://backend.example", apiKey: "k" }, input, async () => new Response("{}", { status: 409 })),
    /no longer waiting/,
  );
});

test("long conversations send the newest turns that fit, starting with your message", () => {
  const turns = Array.from({ length: 10 }, (_, i) => ({
    role: i % 2 ? "assistant" : "user",
    content: "x".repeat(10000),
  }));
  const { messages, dropped } = fitHistory(turns);
  assert.equal(messages[0].role, "user");
  assert.ok(messages.reduce((n, m) => n + m.content.length, 0) <= 46000);
  assert.equal(messages.length + dropped, 10);
  assert.equal(messages.at(-1), turns.at(-1));
});

test("images go with the message they were attached to; later turns get a note", () => {
  const message = {
    role: "user",
    content: "Look",
    mode: { style: "balanced", research: false },
    attachments: [{ id: "a", kind: "image", name: "chart.png" }],
  };
  const images = new Map([["a", "data:image/jpeg;base64,AAAA"]]);
  const now = wireMessage(message, { latest: true, images });
  assert.deepEqual(now.content[1], { type: "image_url", image_url: { url: "data:image/jpeg;base64,AAAA" } });
  assert.deepEqual(now.mode, message.mode);
  assert.equal(wireMessage(message, { latest: false, images }).content, "Look\n\n[Image shared earlier: chart.png]");
});
