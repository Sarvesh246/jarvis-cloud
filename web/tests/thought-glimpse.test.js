import test from "node:test";
import assert from "node:assert/strict";
import { thoughtGlimpse, thoughtStep, GLIMPSE_CHARS } from "../src/lib/thought-glimpse.js";

test("nothing to show before the model shares any thinking", () => {
  assert.deepEqual(thoughtGlimpse(""), { heading: "", line: "" });
  assert.deepEqual(thoughtGlimpse(undefined), { heading: "", line: "" });
  assert.deepEqual(thoughtGlimpse("   \n "), { heading: "", line: "" });
});

test("the newest heading and the sentence being thought right now", () => {
  const reasoning = "**Reading the request**\nThey want a forecast. That needs a place.\n\n**Checking the location**\nShared coordinates point to College Station. I should use those and";
  assert.deepEqual(thoughtGlimpse(reasoning), {
    heading: "Checking the location",
    line: "Shared coordinates point to College Station. I should use those and",
  });
});

test("markdown headings, links and inline markup become plain text", () => {
  const { heading, line } = thoughtGlimpse("## Comparing *both* options\nThe `second` one is [cheaper](https://example.com) overall.");
  assert.equal(heading, "Comparing both options");
  assert.equal(line, "The second one is cheaper overall.");
});

test("models without headings still show their current thought", () => {
  const { heading, line } = thoughtGlimpse("First I add the numbers. Then I check the units carefully because the user mixed miles and kilometres.");
  assert.equal(heading, "");
  assert.equal(line, "Then I check the units carefully because the user mixed miles and kilometres.");
});

test("a very short last sentence keeps the one before it for context", () => {
  assert.equal(thoughtGlimpse("The total comes to 391. Good.").line, "The total comes to 391. Good.");
});

test("long thoughts are trimmed from the front at a word boundary", () => {
  const { line } = thoughtGlimpse("word ".repeat(200) + "and finally the end");
  assert.ok(line.length <= GLIMPSE_CHARS, line.length);
  assert.ok(line.startsWith("…word"));
  assert.ok(line.endsWith("and finally the end"));
});

test("long headings are shortened", () => {
  const { heading } = thoughtGlimpse("**" + "Considering several very long alternatives for this ".repeat(1) + "particular part of the plan**\nok");
  assert.ok(heading.length <= 64);
  assert.ok(heading.endsWith("…"));
});

test("the step count only moves when a thought is finished", () => {
  assert.equal(thoughtStep("Thinking about"), 0);
  assert.equal(thoughtStep("Thinking about it. Next"), 1);
  assert.equal(thoughtStep("Thinking about it. Next\nAnd"), 2);
});
