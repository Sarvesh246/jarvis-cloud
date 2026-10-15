import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { BlobPreconditionFailedError } from "@vercel/blob";
import { WorkStore, workAccountPath, workDocumentPath, readWorkContext, MAX_WORK_INPUT_BYTES } from "../server/work-store.js";
import { HttpError } from "../server/security.js";
import { WORK_LIMITS } from "../shared/work-records.js";

export function memoryBlob() {
  const files = new Map(); let etag = 0; const deleted = [];
  return { files, deleted,
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
    async del(paths) { for (const path of [].concat(paths)) { deleted.push(path); files.delete(path); } },
  };
}
const draft = (id = "record-one", extra = {}) => ({ id, workspaceId: "refund", title: "My return", notes: "Ordered on the 3rd",
  check: { id: "refund", input: { owed: "$49.99 for order-one" } }, ...extra });
const output = { status: "unverified", summary: "No source readback", result: { observed: false }, limitations: ["No external action."] };
const status = expected => error => error.status === expected;
const sha = text => createHash("sha256").update(text).digest("hex");
const indexOf = (blob, sub = "owner") => blob.files.get(workAccountPath(sub)).text;

test("work records persist privately across instances and isolate accounts", async () => {
  const blob = memoryBlob(), owner = new WorkStore("owner", blob);
  const first = await owner.save(draft());
  assert.equal(first.scope, "personal"); assert.equal(first.output, null); assert.equal(first.notes, "Ordered on the 3rd");
  assert.match(first.revision, /^[a-f0-9-]{36}$/);
  assert.deepEqual(await new WorkStore("owner", blob).record(first.id), first);
  assert.deepEqual(await new WorkStore("other", blob).list(), []);
  await assert.rejects(new WorkStore("other", blob).record(first.id), status(404));
  assert.notEqual(workAccountPath("owner"), workAccountPath("other"));
  assert.ok(!workAccountPath("owner").includes("owner"));
});

test("documents are stored once under their content hash, outside the index", async () => {
  const blob = memoryBlob(), store = new WorkStore("owner", blob);
  const text = "Order A-100\nRefund promised on 5 October";
  const saved = await store.save(draft("one", { documents: [{ id: "doc-1", slot: "order", name: "receipt.txt", text }] }));
  assert.deepEqual(saved.documents, [{ id: "doc-1", slot: "order", name: "receipt.txt", sha: sha(text), chars: text.length }]);
  assert.equal(blob.files.get(workDocumentPath("owner", sha(text))).text, text);
  assert.ok(!indexOf(blob).includes("Refund promised"), "document text never lands in the index");
  assert.ok(workDocumentPath("owner", sha(text)).startsWith(workAccountPath("owner").replace("index.json", "documents/")));
  // A later save can keep the document by reference; its size comes from the server.
  const kept = await store.save(draft("one", { title: "Renamed", documents: [{ id: "doc-1", slot: "order", name: "receipt.txt", sha: sha(text), chars: 1 }] }), saved.revision);
  assert.equal(kept.documents[0].chars, text.length);
  assert.deepEqual(await store.documents(kept), { [sha(text)]: text });
  const context = await readWorkContext("owner", "one", { storage: blob });
  assert.equal(context.record.id, "one"); assert.equal(context.documents[sha(text)], text);
});

test("references must belong to the account, and slots must belong to the workspace", async () => {
  const blob = memoryBlob(), store = new WorkStore("owner", blob);
  const foreign = await new WorkStore("other", blob).save(draft("theirs", { documents: [{ id: "d", slot: "order", name: "secret.txt", text: "Other account" }] }));
  await assert.rejects(store.save(draft("mine", { documents: [{ id: "d", slot: "order", name: "secret.txt", sha: foreign.documents[0].sha }] })), status(409));
  await assert.rejects(store.save(draft("mine", { documents: [{ id: "d", slot: "not-a-slot", name: "x.txt", text: "x" }] })), status(400));
  await assert.rejects(store.save(draft("mine", { documents: [{ id: "d", slot: "order", name: "x.txt" }] })), status(400));
  await assert.rejects(store.save(draft("mine", { documents: [{ id: "d", slot: "order", name: "big.txt", text: "x".repeat(WORK_LIMITS.documentChars + 1) }] })), status(413));
  const many = Array.from({ length: WORK_LIMITS.documents + 1 }, (_, i) => ({ id: `d${i}`, slot: "extra", name: `${i}.txt`, text: "x" }));
  await assert.rejects(store.save(draft("mine", { documents: many })), status(400));
  const heavy = Array.from({ length: 3 }, (_, i) => ({ id: `h${i}`, slot: "extra", name: `${i}.txt`, text: String(i).repeat(WORK_LIMITS.documentChars) }));
  await assert.rejects(store.save(draft("mine", { documents: heavy })), status(413));
  assert.equal((await store.list()).length, 0);
});

test("unreferenced document text is removed when a workspace drops it or is deleted", async () => {
  const blob = memoryBlob(), store = new WorkStore("owner", blob);
  const shared = "Shared terms"; const solo = "Only in one";
  const a = await store.save(draft("a", { documents: [{ id: "s", slot: "order", name: "terms.txt", text: shared }, { id: "o", slot: "extra", name: "solo.txt", text: solo }] }));
  await store.save(draft("b", { documents: [{ id: "s", slot: "order", name: "terms.txt", text: shared }] }));
  const trimmed = await store.save(draft("a", { documents: [{ id: "s", slot: "order", name: "terms.txt", sha: sha(shared) }] }), a.revision);
  assert.deepEqual(blob.deleted, [workDocumentPath("owner", sha(solo))]);
  await store.delete("a", trimmed.revision);
  assert.ok(blob.files.has(workDocumentPath("owner", sha(shared))), "still used by another workspace");
  await store.delete("b", (await store.record("b")).revision);
  assert.ok(!blob.files.has(workDocumentPath("owner", sha(shared))));
});

test("save strips forged results; a result survives edits that leave its check unchanged", async () => {
  const store = new WorkStore("owner", memoryBlob(), { engine: async () => output });
  const first = await store.save(draft("one", { output: { status: "completed" }, revision: "forged", deleted: true, updated: "forged" }));
  assert.equal(first.output, null); assert.notEqual(first.revision, "forged"); assert.equal(first.deleted, undefined);
  const run = await store.run(first.id, first.revision);
  assert.deepEqual(run.output, output);
  const renamed = await store.save(draft("one", { title: "Renamed", notes: "More context" }), run.revision);
  assert.deepEqual(renamed.output, output, "notes and names do not invalidate a check");
  const edited = await store.save(draft("one", { check: { id: "refund", input: { owed: "$10" } } }), renamed.revision);
  assert.equal(edited.output, null);
  await assert.rejects(store.save(draft("one", { check: { id: "form", input: {} } }), edited.revision), status(400));
  const custom = await store.save({ id: "mine", workspaceId: "custom", title: "Weekly report", brief: "Summarise the week.", starters: ["Draft it"], check: { id: "form", input: {} } });
  assert.equal(custom.brief, "Summarise the week."); assert.deepEqual(custom.starters, ["Draft it"]);
  const plain = await store.save({ id: "plain", workspaceId: "job-application", title: "Apply", brief: "ignored for catalogue workspaces" });
  assert.equal(plain.brief, undefined); assert.equal(plain.check, null);
  await assert.rejects(store.run(plain.id, plain.revision), status(400));
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
    assert.equal(id, "refund"); assert.equal(input.owed, "$49.99 for order-one"); entered(); await gate; return output;
  } });
  const first = await store.save(draft()); const running = store.run(first.id, first.revision);
  await enteredPromise;
  const edit = await store.save(draft(first.id, { check: { id: "refund", input: { owed: "$12" } } }), first.revision);
  release(); await assert.rejects(running, status(409));
  assert.deepEqual(await store.record(first.id), edit);
});

test("deletion tombstones defeat stale saves and imports and remove retained inputs", async () => {
  const blob = memoryBlob(), store = new WorkStore("owner", blob);
  const first = await store.save(draft()); const tombstone = await store.delete(first.id, first.revision);
  assert.equal(tombstone.deleted, true); assert.equal(tombstone.check, undefined);
  assert.deepEqual(await store.list(), []);
  await assert.rejects(store.record(first.id), status(404));
  await assert.rejects(store.save(draft(), first.revision), status(409));
  await assert.rejects(store.save(draft()), status(409));
  await assert.rejects(store.import([draft()]), status(409));
  assert.ok(!indexOf(blob).includes("order-one"));
});

test("safe IDs, supported workspaces, scopes and bounded JSON are enforced", async () => {
  const store = new WorkStore("owner", memoryBlob());
  for (const id of ["../other", "__proto__", "constructor", "", "x".repeat(101)]) await assert.rejects(store.save(draft(id)), status(400));
  for (const workspaceId of ["unknown", "retired", 3, undefined]) await assert.rejects(store.save(draft("one", { workspaceId })), status(400));
  await assert.rejects(store.save(draft("one", { scope: "shared" })), status(400));
  await assert.rejects(store.save(draft("one", { notes: "x".repeat(WORK_LIMITS.notes + 1) })), status(413));
  await assert.rejects(store.save(draft("one", { check: { id: "refund", input: { owed: "é".repeat(MAX_WORK_INPUT_BYTES / 2) } } })), status(413));
  await assert.rejects(store.save(draft("one", { check: { id: "refund", input: JSON.parse('{"__proto__":{"polluted":true}}') } })), status(400));
  await assert.rejects(store.save(draft("one", { check: { id: "refund", input: { owed: 12 } } })), status(400), "answers are words, not numbers");
  await assert.rejects(store.save(draft("one", { check: { id: "refund", input: { order: { reference: "A" } } } })), status(400), "only the check’s own questions");
  const deep = {}; let cursor = deep; for (let i = 0; i < 40; i++) cursor = cursor.child = {};
  await assert.rejects(store.save(draft("one", { check: { id: "refund", input: deep } })), status(400));
  await assert.rejects(store.save({ id: "c", workspaceId: "custom", title: "Mine", starters: Array(WORK_LIMITS.starters + 1).fill("go") }), status(400));
});

test("records saved before workspaces are upgraded on read, and retired ones stay readable", async () => {
  const blob = memoryBlob();
  blob.files.set(workAccountPath("owner"), { etag: "1", text: JSON.stringify({ schemaVersion: 1, records: {
    refund: { id: "refund", capabilityId: 3, title: "Old refund", scope: "personal", revision: "r1", updated: "2026-10-01T00:00:00Z", output: null,
      input: { record: { id: "c", orderId: "A-1", expectedCents: 4999, currency: "USD", followupAt: "2026-10-20T00:00:00Z" }, observations: [{ transactionId: "t", source: "bank", orderId: "A-1", currency: "USD", amountCents: 2000, status: "settled" }] } },
    study: { id: "study", capabilityId: 8, title: "Study runs", scope: "work", revision: "r2", updated: "2026-10-02T00:00:00Z", output: null, input: { tolerance: 0 } },
  } }) });
  const store = new WorkStore("owner", blob, { engine: async () => output });
  const upgraded = await store.record("refund");
  assert.equal(upgraded.workspaceId, "refund"); assert.equal(upgraded.revision, "r1");
  assert.deepEqual(upgraded.check.input, { owed: "49.99 USD", chaseBy: "2026-10-20", arrived: "20 USD" });
  const retired = await store.record("study");
  assert.equal(retired.workspaceId, "retired"); assert.deepEqual(retired.legacy.input, { tolerance: 0 });
  await assert.rejects(store.run("study", "r2"), status(400));
  await assert.rejects(store.save({ ...retired }, "r2"), status(400));
  assert.equal((await store.run("refund", "r1")).output.status, "unverified");
  assert.equal((await store.delete("study", "r2")).deleted, true);
});

test("import is atomic, uploads documents, creates fresh revisions and discards supplied results", async () => {
  const blob = memoryBlob(), store = new WorkStore("owner", blob);
  const imported = await store.import([draft("one", { output, revision: "old", documents: [{ id: "d", slot: "order", name: "r.txt", text: "Receipt" }] }), draft("two")]);
  assert.equal(imported[0].output, null); assert.notEqual(imported[0].revision, "old");
  assert.equal(imported[0].documents[0].sha, sha("Receipt")); assert.ok(blob.files.has(workDocumentPath("owner", sha("Receipt"))));
  await assert.rejects(store.import([draft("three"), draft("one")]), status(409));
  assert.equal((await store.list()).length, 2);
  await assert.rejects(store.import([draft("same"), draft("same")]), status(400));
  await assert.rejects(store.import([{ id: "old", capabilityId: 31, title: "Effort", input: {} }]), status(400));
});

test("record and total-byte bounds reject an import atomically", async () => {
  const store = new WorkStore("owner", memoryBlob());
  await store.import(Array.from({ length: 100 }, (_, i) => draft(`r${i}`)));
  await assert.rejects(store.save(draft("overflow")), status(413));
  assert.equal((await store.list()).length, 100);
  const large = new WorkStore("large", memoryBlob());
  await assert.rejects(large.import(Array.from({ length: 40 }, (_, i) => draft(`r${i}`, { check: { id: "refund", input: { owed: "x".repeat(60_000) } } }))), status(413));
  assert.equal((await large.list()).length, 0);
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

test("the real check engine persists results and semantic input errors stay actionable", async () => {
  const store = new WorkStore("owner", memoryBlob());
  const record = await store.save({ id: "split", workspaceId: "split-costs", title: "Trip", check: { id: "cost-split", input: {
    people: "Ana, Ben", spent: "Ana paid $40 for fuel" } } });
  const run = await store.run(record.id, record.revision);
  assert.deepEqual(run.output.result.payments, [{ from: "Ben", to: "Ana", amount: 20 }]);
  const invalid = await store.save({ id: "invalid", workspaceId: "split-costs", title: "Trip", check: { id: "cost-split", input: { people: "Ana", spent: "Ana paid $5" } } });
  await assert.rejects(store.run(invalid.id, invalid.revision), error => error.status === 400 && /at least two people/.test(error.message));
});
