import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { readJson, HttpError } from "../server/security.js";

const invalid = error => error instanceof HttpError && error.status === 400;
const oversized = error => error instanceof HttpError && error.status === 413;
const stream = chunks => Readable.from(chunks);

test("JSON requests reject damaged UTF-8 instead of silently changing user content", async () => {
  for (const bad of [[0xff], [0xc0, 0xaf], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80], [0xe2, 0x82]]) {
    const chunks = [Buffer.from('{"text":"'), Buffer.from(bad), Buffer.from('"}')];
    await assert.rejects(readJson(stream(chunks)), invalid);
  }
});

test("JSON requests preserve split Unicode and literal replacement characters", async () => {
  const value = { text: "Hello 日本語 🌦️ �", markdown: "**words**\n```js\nx = '$5'\n```\n$\\alpha$", table: "| A | B |\n| - | - |" };
  const bytes = Buffer.from(JSON.stringify(value));
  assert.deepEqual(await readJson(stream([...bytes].map(byte => Buffer.from([byte]))), bytes.length), value);
  assert.deepEqual(await readJson({ body: JSON.stringify(value) }, bytes.length), value);
  assert.deepEqual(await readJson({ body: value }, bytes.length), value);
  await assert.rejects(readJson(stream([bytes]), bytes.length - 1), oversized);
});

test("raw buffered JSON bodies use the same parsing and byte limit as request streams", async () => {
  const bytes = Buffer.from('{"text":"日本語"}');
  assert.deepEqual(await readJson({ body: bytes }, bytes.length), { text: "日本語" });
  await assert.rejects(readJson({ body: bytes }, bytes.length - 1), oversized);
  await assert.rejects(readJson({ body: Buffer.from([0x22, 0xff, 0x22]) }), invalid);
  await assert.rejects(readJson({ body: Buffer.from('{"text":') }), invalid);
});

test("decoded request streams count UTF-8 bytes and return controlled JSON errors", async () => {
  const value = { text: "日本語 🌦️" }, text = JSON.stringify(value), size = Buffer.byteLength(text);
  assert.deepEqual(await readJson(stream([text.slice(0, 8), text.slice(8)]), size), value);
  await assert.rejects(readJson(stream([text]), size - 1), oversized);
  for (const text of ["", "{", '{"x":true} trailing', '\ufeff{"x":true}']) {
    await assert.rejects(readJson(stream([Buffer.from(text)])), invalid);
    await assert.rejects(readJson({ body: text }), invalid);
  }
});

test("over-limit JSON stops consuming the request and closes its iterator", async () => {
  let afterLimit = false, closed = false;
  const req = { async *[Symbol.asyncIterator]() {
    try { yield Buffer.alloc(11); afterLimit = true; throw new Error("must not consume remainder"); }
    finally { closed = true; }
  } };
  await assert.rejects(readJson(req, 10), oversized);
  assert.equal(afterLimit, false);
  assert.equal(closed, true);
});
