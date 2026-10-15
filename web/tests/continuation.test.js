import test from "node:test";
import assert from "node:assert/strict";
import { CONTINUE_NOTE, addNote, continueRequest, joinOnto, retryRequest } from "../src/lib/continuation.js";

const text = "Train each muscle twice a week. An upper/lower split covers that in four days, with";

test("a continuation that restates the last words joins without a stutter", () => {
  assert.equal(joinOnto(text, "four days, with rest days between them."), " rest days between them.");
  assert.equal(joinOnto(text, " with rest days between them."), " rest days between them.");
});

test("a continuation that repeats the last stretch after a lead-in is trimmed", () => {
  assert.equal(
    joinOnto(text, "…An upper/lower split covers that in four days, with rest between."),
    " rest between.",
  );
});

test("a clean continuation is kept whole", () => {
  assert.equal(joinOnto(text, " rest days between them."), " rest days between them.");
  assert.equal(joinOnto("", "Fresh start."), "Fresh start.");
});

test("a cut-off reply is carried on as the assistant's own words", () => {
  const request = {
    conversationId: "c",
    runId: "a",
    messages: [{ role: "user", content: "Plan my week", mode: { style: "concise", research: true } }],
  };
  const next = continueRequest(request, "Monday: upper", "b");
  assert.equal(next.runId, "b");
  assert.deepEqual(next.messages.at(-2), { role: "assistant", content: "Monday: upper" });
  assert.equal(next.messages.at(-1).content, CONTINUE_NOTE);
  assert.deepEqual(next.messages.at(-1).mode, { style: "concise", research: true });
  assert.equal(request.messages.length, 1); // the original is untouched
});

test("an interrupted reply with no answer yet keeps what was already looked into", () => {
  const request = { conversationId: "c", runId: "a", messages: [{ role: "user", content: "Best split?" }] };
  const next = retryRequest(request, ["workout split research"], "b");
  assert.match(next.messages[0].content, /^Best split\?\n\n\[Vaelo request: .*workout split research/);
  assert.equal(request.messages[0].content, "Best split?");
});

test("notes reach messages with images too", () => {
  const parts = [{ type: "image_url", image_url: { url: "data:image/png;base64,AA==" } }, { type: "text", text: "What is this?" }];
  assert.equal(addNote(parts, "N")[1].text, "What is this?\n\nN");
  assert.equal(addNote([parts[0]], "N")[0].text, "N");
});
