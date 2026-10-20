import test from "node:test";
import assert from "node:assert/strict";
import { previewOf } from "../src/lib/format.js";

const chat = (content) => ({ messages: [{ id: "a", role: "assistant", content }] });

test("a conversation's preview leaves out fenced blocks of either kind", () => {
  assert.equal(previewOf(chat("Your weekend\n\n```js\nconst a = 1;\n```\n\nCosts $715.")), "Your weekend Costs $715.");
  assert.equal(previewOf(chat('Your weekend\n\n~~~\n{"type":"overview","items":[]}\n~~~\n\nCosts $715.')), "Your weekend Costs $715.");
});

test("a half-written fence does not leak into the preview", () => {
  assert.equal(previewOf(chat("Summary first\n\n~~~\n{\"type\":\"over")), "Summary first");
});
