import test from "node:test";
import assert from "node:assert/strict";
import { BlobPreconditionFailedError } from "@vercel/blob";
import { WorkStore, workAccountPath, readWorkContext, MAX_WORK_INPUT_BYTES } from "../server/work-store.js";
import { HttpError } from "../server/security.js";

export function memoryBlob() {
  const files = new Map(); let etag = 0;
  return { files,
    async get(path, options) {
      assert.equal(options.access, "private"); assert.equal(options.useCache, false);
      const stored = files.get(path);
      return stored ? { stream: new Response(stored.text).body, blob: { etag: stored.etag } } : null;
    },
    async put(path, text, options) {
      assert.equal(options.access, "private"); assert.equal(options.addRandomSuffix, false);
      const old = files.get(path);
      if (options.ifMatch && old?.etag !== options.ifMatch) throw new BlobPreconditionFailedError();
      if (!options.allowOverwrite && old) throw new Error("Blob already exists");
      files.set(path, { text, etag: String(++etag) });
    },
  };
}
const draft = (id = "record-one", extra = {}) => ({ id, capabilityId: 3, title: "My return", input: { orderId: "order-one" }, ...extra });
const output = { status: "unverified", summary: "No source readback", result: { observed: false }, limitations: ["No external action."] };
const status = expected => error => error.status === expected;

test("work records persist privately across instances and isolate accounts", async () => {
  const blob = memoryBlob(), owner = new WorkStore("owner", blob);
  const first = await owner.save(draft());
  assert.equal(first.scope, "personal"); assert.equal(first.output, null);
  assert.match(first.revision, /^[a-f0-9-]{36}$/);
  assert.deepEqual(await new WorkStore("owner", blob).record(first.id), first);
  assert.deepEqual(await new WorkStore("other", blob).list(), []);
  await assert.rejects(new WorkStore("other", blob).record(first.id), status(404));
  assert.notEqual(workAccountPath("owner"), workAccountPath("other"));
  assert.ok(!workAccountPath("owner").includes("owner"));
});

test("save strips forged results and metadata, and editing invalidates a trusted run", async () => {
  const store = new WorkStore("owner", memoryBlob(), { engine: async () => output });
  const first = await store.save(draft("one", { output: { status: "completed" }, revision: "forged", deleted: true, updated: "forged" }));
  assert.equal(first.output, null); assert.notEqual(first.revision, "forged"); assert.equal(first.deleted, undefined);
  const run = await store.run(first.id, first.revision);
  assert.deepEqual(run.output, output);
  const edited = await store.save(draft("one", { capabilityId: 4, scope: "client", input: { changed: true } }), run.revision);
  assert.equal(edited.output, null); assert.equal(edited.capabilityId, 4); assert.deepEqual(edited.input, { changed: true });
});

test("simultaneous disjoint writes survive ETag races and stale edits cannot overwrite", async () => {
  const store = new WorkStore("owner", memoryBlob());
  const [a, b] = await Promise.all([store.save(draft("one")), store.save(draft("two"))]);
  assert.equal((await store.list()).length, 2);
  const winner = await store.save(draft("one", { title: "Winner" }), a.revision);
  await assert.rejects(store.save(draft("one", { title: "Stale" }), a.revision), status(409));
  assert.equal((await store.record("one")).revision, winner.revision);
  assert.equal((await store.record("two")).revision, b.revision);
});

test("a slow run cannot attach old-input output to a newer edit", async () => {
  let release, entered;
  const enteredPromise = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const store = new WorkStore("owner", memoryBlob(), { engine: async (id, input) => {
    assert.equal(id, 3); assert.equal(input.orderId, "order-one"); entered(); await gate; return output;
  } });
  const first = await store.save(draft()); const running = store.run(first.id, first.revision);
  await enteredPromise;
  const edit = await store.save(draft(first.id, { input: { orderId: "new-order" } }), first.revision);
  release(); await assert.rejects(running, status(409));
  assert.deepEqual(await store.record(first.id), edit);
});

test("deletion tombstones defeat stale saves and imports and remove retained inputs", async () => {
  const blob = memoryBlob(), store = new WorkStore("owner", blob);
  const first = await store.save(draft()); const tombstone = await store.delete(first.id, first.revision);
  assert.equal(tombstone.deleted, true); assert.equal(tombstone.input, undefined);
  assert.deepEqual(await store.list(), []);
  await assert.rejects(store.record(first.id), status(404));
  await assert.rejects(store.save(draft(), first.revision), status(409));
  await assert.rejects(store.save(draft()), status(409));
  await assert.rejects(store.import([draft()]), status(409));
  const text = blob.files.get(workAccountPath("owner")).text;
  assert.ok(!text.includes("order-one"));
});

test("safe IDs, supported capabilities, scopes and bounded JSON are enforced", async () => {
  const store = new WorkStore("owner", memoryBlob());
  for (const id of ["../other", "__proto__", "constructor", "", "x".repeat(101)]) await assert.rejects(store.save(draft(id)), status(400));
  for (const capabilityId of [0, 37, "3", 1.5]) await assert.rejects(store.save(draft("one", { capabilityId })), status(400));
  await assert.rejects(store.save(draft("one", { scope: "shared" })), status(400));
  await assert.rejects(store.save(draft("one", { input: { large: "é".repeat(MAX_WORK_INPUT_BYTES / 2) } })), status(413));
  await assert.rejects(store.save(draft("one", { input: JSON.parse('{"__proto__":{"polluted":true}}') })), status(400));
  await assert.rejects(store.save(draft("one", { input: { number: NaN } })), status(400));
  const deep = {}; let cursor = deep; for (let i = 0; i < 40; i++) cursor = cursor.child = {};
  await assert.rejects(store.save(draft("one", { input: deep })), status(413));
});

test("import is atomic, creates fresh revisions and discards supplied execution results", async () => {
  const store = new WorkStore("owner", memoryBlob());
  const imported = await store.import([draft("one", { output, revision: "old" }), draft("two")]);
  assert.equal(imported[0].output, null); assert.notEqual(imported[0].revision, "old");
  await assert.rejects(store.import([draft("three"), draft("one")]), status(409));
  assert.equal((await store.list()).length, 2);
  await assert.rejects(store.import([draft("same"), draft("same")]), status(400));
});

test("record and total-byte bounds reject an import atomically", async () => {
  const store = new WorkStore("owner", memoryBlob());
  await store.import(Array.from({ length: 100 }, (_, i) => draft(`r${i}`)));
  await assert.rejects(store.save(draft("overflow")), status(413));
  assert.equal((await store.list()).length, 100);
  const large = new WorkStore("large", memoryBlob());
  await assert.rejects(large.import(Array.from({ length: 40 }, (_, i) => draft(`r${i}`, { input: { data: "x".repeat(60_000) } }))), status(413));
  assert.equal((await large.list()).length, 0);
});

test("only selected active work contributes bounded context under the authenticated account", async () => {
  const blob = memoryBlob(), store = new WorkStore("owner", blob);
  await store.save(draft("selected", { input: { text: "x".repeat(20_000) } }));
  await store.save(draft("private", { input: { text: "SECRET OTHER RECORD" } }));
  await assert.rejects(readWorkContext("owner", "selected", { storage: blob, maxCharacters: 1000 }), status(413));
  await store.save(draft("small", { input: { note: "Selected input" } }));
  const context = await readWorkContext("owner", "small", { storage: blob, maxCharacters: 1000 });
  assert.equal(JSON.parse(context).capabilityId, 3); assert.ok(!context.includes("SECRET OTHER RECORD"));
  await assert.rejects(readWorkContext("other", "selected", { storage: blob }), status(404));
});

test("invalid or oversized engine output never becomes durable trusted output", async () => {
  const blob = memoryBlob(), store = new WorkStore("owner", blob, { engine: async () => ({ ...output, result: "x".repeat(70_000) }) });
  const first = await store.save(draft()); await assert.rejects(store.run(first.id, first.revision), status(413));
  assert.equal((await store.record(first.id)).revision, first.revision);
  store.engine = async () => ({ status: "completed" });
  await assert.rejects(store.run(first.id, first.revision), status(500));
  assert.equal((await store.record(first.id)).output, null);
});

test("account readback errors preserve honest not-found and service-unavailable status", async () => {
  const store = new WorkStore("owner", memoryBlob(), { engine: async () => { throw new HttpError(503, "Document sync is not configured."); } });
  const first = await store.save(draft());
  await assert.rejects(store.run(first.id, first.revision), status(503));
  store.engine = async () => { throw new HttpError(404, "Document not found."); };
  await assert.rejects(store.run(first.id, first.revision), status(404));
  assert.equal((await store.record(first.id)).revision, first.revision);
});

test("real capability dispatcher results persist and semantic input errors remain actionable", async () => {
  const store = new WorkStore("owner", memoryBlob());
  const record = await store.save(draft("disagreement", { capabilityId: 35, input: {
    operation: "sum", numbers: [2, 3], predictions: [{ id: "five", value: "5" }, { id: "six", value: "6" }],
  } }));
  const run = await store.run(record.id, record.revision);
  assert.equal(run.output.result.actual, 5); assert.deepEqual(run.output.result.supported, ["five"]);
  const invalid = await store.save(draft("invalid", { capabilityId: 35, input: { operation: "sum", numbers: [], predictions: [] } }));
  await assert.rejects(store.run(invalid.id, invalid.revision), error => error.status === 400 && /exactly two predictions/.test(error.message));
});
