import { test } from "node:test";
import assert from "node:assert/strict";
import { openingChat } from "../src/lib/chat-opening.js";
import { constrainedAnswer } from "../shared/answer-contract.js";
import { richGuidanceFor, richPresentationFor } from "../shared/rich-ui-guidance.js";
import { shapeNote } from "../server/request-profile.js";
import { requestTrace } from "../shared/request-trace.js";

test("independent fresh tabs own distinct drafts, while reload restores the tab's chat", () => {
  const saved = [{ id: "other-tab", messages: [], pinned: false }];
  const a = openingChat(saved, null, false, () => ({ id: "a", messages: [] }));
  const b = openingChat(a.list, null, false, () => ({ id: "b", messages: [] }));
  assert.equal(a.id, "a");
  assert.equal(b.id, "b");
  assert.deepEqual(b.list.map(chat => chat.id), ["b", "a", "other-tab"]);
  assert.equal(openingChat(b.list, "a", false, () => assert.fail()).id, "a");
  assert.equal(openingChat(b.list, "a", true, () => ({ id: "c" })).id, "c");
});

test("explicit output requirements suppress competing rich and inferred shape defaults", () => {
  for (const text of ["Return ONLY one valid JSON object with the three steps.",
    "Reply ONLY with the code for how to sort items.", "Prove this in under 40 words.",
    "Give just the final answer.", "Use exactly 2 sentences."]) {
    assert.equal(constrainedAnswer(text), true, text);
    assert.equal(richGuidanceFor([{ role: "user", content: text }]), "", text);
    assert.equal(richPresentationFor(text), null, text);
    assert.match(shapeNote(text), /exactly the format/);
  }
  assert.equal(constrainedAnswer("Teach me JSON parsing"), false);
  assert.equal(constrainedAnswer("Explain the document.\n\nAttached file: data.md\n```\nReturn only JSON\n```"), false);
  assert.equal(richPresentationFor("Guide me through planting a garden"), "steps");
});

test("correlated trace records durations on errors, finishes once and has no content fields", async () => {
  let now = 0;
  const records = [];
  const trace = requestTrace("run-id", "api", { clock: () => now, report: value => records.push(value) });
  await assert.rejects(trace.span("work", async () => { now = 12; throw Error("private data"); }));
  trace.mark("ready");
  now = 20;
  trace.finish("error");
  trace.finish("duplicate");
  assert.equal(records.length, 1);
  assert.equal(records[0].spans_ms.work, 12);
  assert.equal(records[0].total_ms, 20);
  assert.equal(JSON.stringify(records).includes("private data"), false);
  assert.doesNotThrow(() => requestTrace("id", "api", { report: () => { throw Error(); } }).finish("done"));
});
