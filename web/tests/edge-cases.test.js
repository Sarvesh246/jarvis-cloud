import test from "node:test";
import assert from "node:assert/strict";
import { chatInput, guestInput } from "../server/chat.js";
import { ChatStore } from "../server/chat-store.js";
import { WorkStore, workDocumentPath } from "../server/work-store.js";
import { runCheck } from "../server/check-engine.js";
import { collectSources } from "../src/lib/sources.js";
import { searchChats } from "../src/lib/format.js";
import { normalizeReplySpacing } from "../src/lib/reply-spacing.js";
import { sortRows, toCSV } from "../src/lib/table.js";
import { isLongReply, docTitle } from "../src/lib/library.js";
import { requestRevision } from "../src/lib/revise.js";
import { refreshWorkReferences } from "../src/lib/workroom.js";
import { ChatSync, mergeChats } from "../src/lib/chat-sync.js";
import { findAmounts, parseDate } from "../shared/plain.js";

const conversationId = "11111111-1111-4111-8111-111111111111";
const now = "2026-10-15T12:00:00Z";

function memory() {
  const files = new Map(); let etag = 0;
  return { files,
    async get(path) {
      const stored = files.get(path);
      return stored ? { stream: new Response(stored.text).body, blob: { etag: stored.etag } } : null;
    },
    async put(path, text, options = {}) {
      const old = files.get(path);
      if (options.ifMatch && old?.etag !== options.ifMatch)
        throw Object.assign(new Error("changed"), { name: "PreconditionFailedError" });
      if (!options.allowOverwrite && !options.ifMatch && old) throw new Error("This value already exists.");
      files.set(path, { text, etag: String(++etag) });
    },
    async del(paths) { for (const path of [].concat(paths)) files.delete(path); },
  };
}

test("a guest's message never asks the model to research the web", () => {
  const body = { conversationId, research: true,
    messages: [{ role: "user", content: "hello", mode: { style: "concise", research: true } }] };
  const input = guestInput(chatInput(body, { guest: true }));
  assert.equal(input.research, false);
  assert.doesNotMatch(input.messages.at(-1).content, /research with sources/);
  assert.match(input.messages.at(-1).content, /concise style/, "the rest of the mode still applies");
  assert.match(chatInput(body).messages.at(-1).content, /research with sources/, "the owner can still research");
});

test("a message made only of empty text parts is refused", () => {
  assert.throws(() => chatInput({ conversationId, messages: [{ role: "user", content: [{ type: "text", text: "  " }] }] }),
    error => error.status === 400);
});

test("dates: month names and impossible months aren't misread", () => {
  assert.equal(parseDate("next month", now), null);
  assert.equal(parseDate("monkey", now), null);
  assert.equal(parseDate("2026-13-01", now), null);
  assert.equal(parseDate("13/13", now), null);
  assert.equal(parseDate("2026-00-10", now), null);
  assert.equal(parseDate("Friday", now), "2026-10-16");
  assert.equal(parseDate("next thurs", now), "2026-10-22");
  assert.equal(parseDate("31/12/2026", now), "2026-12-31");
});

test("buying: a length in months is a fraction of a year", async () => {
  const half = await runCheck("purchase", { options: "Kettle $30, $12 a year", years: "6 months" }, { now });
  assert.equal(half.result.years, 0.5);
  assert.equal(half.result.options[0].total, 36);
  assert.equal((await runCheck("purchase", { options: "Kettle $30", years: "2 years" }, { now })).result.years, 2);
});

test("a group choice too large to search says so instead of calling it impossible", async () => {
  const all = Array.from({ length: 101 }, (_, i) => `opt${i}`).join(", ");
  await assert.rejects(runCheck("group-choice", { people: `Ana: ${all}\nBen: ${all}` }, { now }), /too many choices/);
});

test("a commit that loses to another device removes the parts it staged", async () => {
  const blob = memory();
  const store = new ChatStore("owner", blob);
  const chat = JSON.stringify({ id: "chat-a", title: "A", messages: [] });
  await store.stage({ id: "chat-a", version: "v-1", part: 0, text: chat });
  await store.commit({ id: "chat-a", version: "v-1", parts: 1 });
  await store.stage({ id: "chat-a", version: "v-2", part: 0, text: chat });
  await assert.rejects(store.commit({ id: "chat-a", version: "v-2", base: null, parts: 1 }), error => error.status === 409);
  assert.equal([...blob.files.keys()].some(path => path.includes("v-2")), false);
  assert.equal([...blob.files.keys()].some(path => path.includes("v-1")), true);
});

test("deleting keeps working after hundreds of earlier deletions", async () => {
  const store = new WorkStore("owner", memory(), { now: () => new Date().toISOString() });
  for (let i = 0; i < 503; i++) {
    const saved = await store.save({ id: `record-${i}`, workspaceId: "refund", title: `R${i}` });
    await store.delete(saved.id, saved.revision);
  }
  const { records } = await store.snapshot();
  assert.ok(Object.values(records).filter(item => item.deleted).length <= 500);
});

test("text shared with a workspace deleted mid-save is still there afterwards", async () => {
  const blob = memory();
  const store = new WorkStore("owner", blob);
  const text = "The same lease text";
  const first = await store.save({ id: "first", workspaceId: "refund", title: "One", documents: [{ id: "d1", slot: "extra", name: "a.txt", text }] });
  const realPut = blob.put.bind(blob); let paused;
  // Pause the second save right after its upload, delete the first, then let it finish.
  blob.put = async (path, ...rest) => {
    await realPut(path, ...rest);
    if (path.endsWith(".txt") || path.includes("/documents/")) { blob.put = realPut; await new Promise(resolve => { paused = resolve; }); }
  };
  const second = store.save({ id: "second", workspaceId: "refund", title: "Two", documents: [{ id: "d2", slot: "extra", name: "b.txt", text }] });
  while (!paused) await new Promise(resolve => setTimeout(resolve, 1));
  await store.delete(first.id, first.revision);
  paused();
  const saved = await second;
  assert.equal((await store.documents(saved))[saved.documents[0].sha], text);
  assert.ok(blob.files.has(workDocumentPath("owner", saved.documents[0].sha)));
});

test("links with brackets in them keep their whole address", () => {
  const urls = collectSources("See [Foo](https://en.wikipedia.org/wiki/Foo_(bar)) and https://en.wikipedia.org/wiki/Bar_(baz).")
    .map(source => source.url);
  assert.ok(urls.includes("https://en.wikipedia.org/wiki/Foo_(bar)"));
  assert.ok(urls.includes("https://en.wikipedia.org/wiki/Bar_(baz)"));
});

test("searching conversations finds words with Markdown characters in them", () => {
  const chats = [{ id: "a", title: "Notes", messages: [{ role: "user", content: "rename my_variable and learn C#" }] }];
  assert.equal(searchChats(chats, "my_variable").length, 1);
  assert.equal(searchChats(chats, "C#").length, 1);
  const other = [...chats, { id: "b", title: "Other", messages: [{ role: "user", content: "a cat in **bold**" }] }];
  assert.deepEqual(searchChats(other, "C#").map(result => result.chat.id), ["a"], "C# isn't just c");
  assert.deepEqual(searchChats(other, "cat in bold").map(result => result.chat.id), ["b"]);
});

test("spacing repairs leave bare addresses and file names alone", () => {
  assert.equal(normalizeReplySpacing("Go to www.example.com/search?Q=term now"), "Go to www.example.com/search?Q=term now");
  assert.equal(normalizeReplySpacing("Open file.py?Foo"), "Open file.py?Foo");
  assert.equal(normalizeReplySpacing("Really?Yes."), "Really? Yes.");
});

test("blank cells sort last and spreadsheet formulas are defused", () => {
  const rows = [["a", "30"], ["b", ""], ["c", "10"]];
  assert.deepEqual(sortRows(rows, 1).map(row => row[0]), ["c", "a", "b"]);
  assert.deepEqual(sortRows(rows, 1, "desc").map(row => row[0]), ["a", "c", "b"]);
  assert.equal(toCSV(["x"], [["=SUM(1)"], ["@cmd"], ["-5"], ["+1+1"]]), "x\r\n'=SUM(1)\r\n'@cmd\r\n-5\r\n'+1+1");
});

test("a comment line inside code is not a heading", () => {
  const reply = "Run this:\n\n```bash\n# install deps\nnpm i\n```";
  assert.equal(isLongReply(reply), false);
  assert.notEqual(docTitle(reply), "install deps");
});

test("a revision finishes even though the relay numbers its [DONE] frame", async () => {
  const frames = 'id: 0\ndata: {"choices":[{"delta":{"content":"Better words."}}]}\n\nid: 1\ndata: [DONE]\n\nid: 2\nevent: jarvis.complete\ndata: {"ok":true}\n\n';
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(frames, { status: 200 });
  try {
    const revised = await requestRevision({ csrf: "x", source: "Old words.", start: 0, end: 10, instruction: "improve" });
    assert.match(String(revised?.text ?? revised), /Better words/);
  } finally { globalThis.fetch = realFetch; }
});

test("one conversation the server refuses doesn't stop the others syncing", async () => {
  const store = new ChatStore("owner", memory());
  const request = async (path, body) => {
    if (body?.id === "bad") throw Object.assign(new Error("Invalid conversation data."), { status: 400 });
    if (body?.action === "part") return store.stage(body);
    if (body?.action === "commit") return { entry: await store.commit(body) };
    return (await store.manifest()).data;
  };
  const data = new Map();
  const storage = { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
  let issue = "", n = 0;
  const chats = ["bad", "good"].map(id => ({ id, title: id, updated: 1, messages: [{ id: "m", role: "user", text: "hi" }] }));
  const sync = new ChatSync({ sub: "owner", chats, storage, request, uuid: () => `version-${++n}`,
    onChange: () => {}, onConflict: () => {}, onStatus: text => issue = text });
  await sync.tick();
  sync.stop();
  assert.ok((await store.manifest()).data.entries.good, "the good conversation was uploaded");
  assert.match(issue, /aren’t syncing/, "the failure is still reported");
});

test("a pin on one device and a message on another merge instead of making a copy", () => {
  const base = { id: "c", title: "T", updated: 1, messages: [{ id: "m1", role: "user", text: "hi" }] };
  const pinned = { ...base, pinned: true, pinnedAt: 5 };
  const longer = { ...base, messages: [...base.messages, { id: "m2", role: "user", text: "more" }] };
  const merged = mergeChats(pinned, longer);
  assert.ok(merged, "merged rather than copied");
  assert.equal(merged.pinned, true);
  assert.equal(merged.messages.length, 2);
  const unpinned = { ...base, pinned: false, pinnedAt: 9 };
  assert.equal(mergeChats({ ...pinned, messages: longer.messages }, unpinned).pinned, false, "the later toggle wins");
});

test("editing a workspace updates the revision every message of its chats will resend", () => {
  const old = { id: "w1", revision: "r1", title: "Lease", workspaceId: "refund" };
  const chats = [{ id: "c", workContext: old, messages: [{ id: "m", role: "user", workContext: old }] },
    { id: "d", workContext: undefined, messages: [{ id: "n", role: "user", workContext: old }] }];
  const next = refreshWorkReferences(chats, { ...old, revision: "r2" }, 7);
  assert.equal(next[0].workContext.revision, "r2");
  assert.equal(next[0].messages[0].workContext.revision, "r2");
  assert.equal(next[1].workContext, undefined, "a chat that stopped using it isn't reattached");
  assert.equal(next[1].messages[0].workContext.revision, "r2");
  const gone = refreshWorkReferences(chats, { id: "w1", deleted: true }, 8);
  assert.equal(gone[0].messages[0].workContext, undefined);
});

test("amounts: negatives, decimal commas, extra decimals and trailing symbols", () => {
  const read = text => findAmounts(text).map(item => [item.amount, item.symbol]);
  assert.deepEqual(read("Ben paid -$10 refund"), []);
  assert.deepEqual(read("- $25"), [[25, "$"]], "a list dash is not a minus");
  assert.deepEqual(read("12,50"), [[12.5, null]]);
  assert.deepEqual(read("$1,200"), [[1200, "$"]]);
  assert.deepEqual(read("$40.999"), [[41, "$"]]);
  assert.deepEqual(read("20€"), [[20, "€"]]);
});
