import { test } from "node:test";
import assert from "node:assert/strict";

import { composeContent, decodeText, readAttachment } from "../src/lib/attachments.js";

const utf16le = (text, bom = true) => {
  const bytes = new Uint8Array((bom ? 2 : 0) + text.length * 2);
  if (bom) bytes.set([0xff, 0xfe]);
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    bytes[(bom ? 2 : 0) + i * 2] = code & 0xff;
    bytes[(bom ? 2 : 0) + i * 2 + 1] = code >> 8;
  }
  return bytes;
};

test("a PowerShell log saved as UTF-16 reads as its words", async () => {
  const log = "Name    Status\r\n----    ------\r\nSpooler Running\r\n";
  const read = await readAttachment(new File([utf16le(log)], "services.log", { type: "text/plain" }));
  assert.equal(read.state, "ready");
  assert.equal(read.body, "Name    Status\n----    ------\nSpooler Running\n");
  assert.ok(!read.body.includes("\u0000"));
});

test("UTF-16 without a byte-order mark, and big-endian, still decode", () => {
  assert.equal(decodeText(utf16le("plain notes here", false)), "plain notes here");
  const be = new Uint8Array([0xfe, 0xff, 0x00, 0x68, 0x00, 0x69, 0x00, 0xe9]);
  assert.equal(decodeText(be), "hié");
});

test("a Windows-1252 CSV keeps its accents instead of replacement marks", async () => {
  const bytes = new Uint8Array([...Buffer.from("name,city\nRen"), 0xe9, ...Buffer.from(",Montr"), 0xe9, 0x61, 0x6c, 0x0a]);
  const read = await readAttachment(new File([bytes], "export.csv", { type: "text/csv" }));
  assert.equal(read.state, "ready");
  assert.equal(read.body, "name,city\nRené,Montréal\n");
});

test("UTF-8 with or without a byte-order mark is read unchanged", () => {
  assert.equal(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...Buffer.from("café ☕")])), "café ☕");
  assert.equal(decodeText(Buffer.from("naïve — “quoted”")), "naïve — “quoted”");
});

test("a binary file with a text extension is turned away, not pasted as noise", async () => {
  const video = new Uint8Array(4096);
  for (let i = 0; i < video.length; i += 188) video.set([0x47, 0x40, 0x00, 0x10], i);
  const read = await readAttachment(new File([video], "clip.ts", { type: "video/mp2t" }));
  assert.equal(read.state, "unsupported");
  assert.match(read.note, /doesn’t contain readable text/);
});

test("a file with only a byte-order mark or blank lines counts as empty", async () => {
  const bom = await readAttachment(new File([new Uint8Array([0xff, 0xfe])], "blank.txt"));
  assert.equal(bom.state, "empty");
  const blank = await readAttachment(new File(["\r\n\r\n  "], "blank.md"));
  assert.equal(blank.state, "empty");
});

test("a file's own fences can't close the block that carries it", () => {
  const body = "Example:\n````md\n```js\nx()\n```\n````\nEnd";
  const content = composeContent("Review", [{ state: "ready", name: "guide.md", body }]);
  assert.ok(content.startsWith("Review\n\nAttached file: guide.md\n`````markdown\n"));
  assert.ok(content.endsWith("\nEnd\n`````"));
  const plain = composeContent("", [{ state: "ready", name: "a.txt", body: "no fences" }]);
  assert.equal(plain, "Attached file: a.txt\n```\nno fences\n```");
});
