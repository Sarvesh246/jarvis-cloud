import test from "node:test";
import assert from "node:assert/strict";
import { normalizeReplySpacing, normalizeSavedReplySpacing } from "../src/lib/reply-spacing.js";

test("the reported joined sentences have a space after the question mark", () => {
  const text = "I'm Vaelo. How can I help you today, Sarvesh?My name is Vaelo.";
  assert.equal(normalizeReplySpacing(text), text.replace("Sarvesh?My", "Sarvesh? My"));
  assert.equal(normalizeReplySpacing("Ready!Let's go. Fine?!Yes."), "Ready! Let's go. Fine?! Yes.");
});

test("code and URLs preserve their exact punctuation", () => {
  const text = '```js\nconst q = "?My!Name";\n```\n`a?My:b` [link](https://example.com/?My=1) https://example.com/?My=1\n    x?My:y\nWhat?Next';
  assert.equal(normalizeReplySpacing(text), text.replace("What?Next", "What? Next"));
  assert.equal(normalizeReplySpacing('~~~text\nWhat?Next\n~~~'), '~~~text\nWhat?Next\n~~~');
  assert.equal(normalizeReplySpacing('Code: ``a`?My``. Really?Yes.'), 'Code: ``a`?My``. Really? Yes.');
  assert.equal(normalizeReplySpacing('Code: ``first line\na`?My``. Really?Yes.'), 'Code: ``first line\na`?My``. Really? Yes.');
});

test("normal token fragments, decimals and existing whitespace are unchanged", () => {
  for (const text of ["Hel" + "lo", "v1.2.3", "Hello? World! Yes.", "你好？世界", '```js\n"?My']) {
    assert.equal(normalizeReplySpacing(text), text);
  }
});

test("saved assistant replies and versions are repaired while user text is preserved", () => {
  const chat = { id: "chat", messages: [
    { role: "user", content: "What?My", id: "user" },
    { role: "assistant", content: "Yes!Next", id: "reply", versions: [{ content: "Done?Good" }] },
  ] };
  const fixed = normalizeSavedReplySpacing(chat);
  assert.equal(fixed.messages[0], chat.messages[0]);
  assert.equal(fixed.messages[1].content, "Yes! Next");
  assert.equal(fixed.messages[1].versions[0].content, "Done? Good");
  assert.equal(chat.messages[1].content, "Yes!Next");
});
