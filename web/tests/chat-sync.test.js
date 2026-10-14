import test from "node:test";
import assert from "node:assert/strict";
import { BlobPreconditionFailedError } from "@vercel/blob";
import { ChatStore, accountPath } from "../server/chat-store.js";
import { ChatSync, readSyncCache } from "../src/lib/chat-sync.js";
import handler from "../api/chats.js";
import { settings, signSession, cookieNames } from "../server/security.js";

function memoryBlob() {
  const files = new Map();
  let version = 0;
  return {
    files,
    async get(path) {
      const file = files.get(path);
      return file ? { stream: new Response(file.text).body, blob: { etag: file.etag } } : null;
    },
    async put(path, text, options) {
      const old = files.get(path);
      if (options.ifMatch && old?.etag !== options.ifMatch) throw new BlobPreconditionFailedError();
      if (!options.allowOverwrite && old) throw new Error("This blob already exists");
      files.set(path, { text, etag: String(++version) });
    },
  };
}
function memoryStorage() {
  const data = new Map();
  return { getItem: (key) => data.get(key) || null, setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key) };
}
function setup() {
  const blob = memoryBlob();
  const store = new ChatStore("owner", blob);
  const request = async (path, body) => {
    if (body?.action === "part") return store.stage(body);
    if (body?.action === "commit") return { entry: await store.commit(body) };
    const url = new URL(path, "https://test.example");
    if (url.searchParams.has("id")) return { text: await store.part(
      url.searchParams.get("id"), url.searchParams.get("version"), Number(url.searchParams.get("part"))) };
    return (await store.manifest()).data;
  };
  let id = 0;
  const device = (chats = [], storage = memoryStorage(), base = {}) => {
    const state = { chats, conflicts: 0, issue: "", storage };
    state.sync = new ChatSync({ sub: "owner", chats, base, storage, request,
      uuid: () => `version-${++id}`, onChange: (next) => state.chats = next,
      onConflict: () => state.conflicts++, onStatus: (issue) => state.issue = issue });
    return state;
  };
  return { blob, store, request, device };
}
const chat = (id = "chat-one", text = "Hello") => ({ id, title: "A conversation", updated: 1,
  messages: [{ id: "message-one", role: "user", text }], works: { doc: { versions: ["draft"] } }, pinned: true });

test("a second device sees new chats, replies, renames, documents and deletions without reloading", async () => {
  const { device } = setup();
  const desktop = device([chat()]);
  const phone = device();
  await desktop.sync.tick(); await phone.sync.tick();
  assert.deepEqual(phone.chats, desktop.chats);
  desktop.chats = [{ ...chat(), title: "Renamed", messages: [...chat().messages,
    { id: "answer", role: "assistant", text: "Welcome", versions: [{ text: "Welcome" }] }] }];
  desktop.sync.observe(desktop.chats);
  await desktop.sync.tick(); await phone.sync.tick();
  assert.deepEqual(phone.chats, desktop.chats);
  desktop.sync.observe([]);
  await desktop.sync.tick(); await phone.sync.tick();
  assert.deepEqual(phone.chats, []);
});

test("concurrent edits preserve the remote version and a local device copy", async () => {
  const { device } = setup();
  const a = device([chat()]), b = device();
  await a.sync.tick(); await b.sync.tick();
  a.sync.observe([{ ...chat(), title: "Desktop edit" }]);
  b.sync.observe([{ ...chat(), title: "Phone edit" }]);
  await a.sync.tick(); await b.sync.tick(); await a.sync.tick();
  assert.deepEqual(a.chats.map(c => c.title).sort(), ["Desktop edit", "Phone edit (device copy)"]);
  assert.equal(b.conflicts, 1);
});

test("offline deletion survives a restart and does not resurrect the deleted chat", async () => {
  const { device } = setup();
  const a = device([chat()]); await a.sync.tick();
  a.sync.observe([]);
  const cache = readSyncCache("owner", a.storage);
  const restarted = device(cache.chats, a.storage, cache.base);
  await restarted.sync.tick();
  const phone = device(); await phone.sync.tick();
  assert.deepEqual(phone.chats, []);
});

test("an edit made while an upload is in flight stays pending and syncs next time", async () => {
  const { device } = setup();
  const a = device([chat()]);
  const original = a.sync.request;
  a.sync.request = async (path, body) => {
    if (body?.action === "part") a.sync.observe([{ ...chat(), title: "Edited during upload" }]);
    return original(path, body);
  };
  await a.sync.tick();
  assert.equal(a.sync.dirty("chat-one"), true);
  a.sync.request = original;
  await a.sync.tick();
  const phone = device(); await phone.sync.tick();
  assert.equal(phone.chats[0].title, "Edited during upload");
});

test("large conversations cross the API in bounded chunks without losing content", async () => {
  const { device } = setup();
  const original = chat("large", "x".repeat(1_100_000));
  const a = device([original]); await a.sync.tick();
  const b = device(); await b.sync.tick();
  assert.deepEqual(b.chats, [original]);
});

test("conditional manifest writes preserve disjoint simultaneous changes and reject stale edits", async () => {
  const { store } = setup();
  const write = async (id, version, base = null) => {
    await store.stage({ id, version, part: 0, text: JSON.stringify(chat(id)) });
    return store.commit({ id, version, base, parts: 1 });
  };
  await Promise.all([write("one", "v-one"), write("two", "v-two")]);
  assert.equal(Object.keys((await store.manifest()).data.entries).length, 2);
  await write("one", "v-three", "v-one");
  await assert.rejects(write("one", "v-four", "v-one"), error => error.status === 409);
  assert.equal((await store.manifest()).data.entries.one.version, "v-three");
});

test("storage is account scoped, immutable, and does not accept paths or incomplete commits", async () => {
  const { store, blob } = setup();
  assert.notEqual(accountPath("owner"), accountPath("someone-else"));
  await assert.rejects(store.stage({ id: "../other", version: "v1", part: 0, text: "x" }));
  await assert.rejects(store.commit({ id: "one", version: "v1", parts: 1 }), e => e.status === 404);
  await store.stage({ id: "one", version: "v1", part: 0, text: JSON.stringify(chat("one")) });
  await assert.rejects(store.stage({ id: "one", version: "v1", part: 0, text: "changed" }));
  const other = new ChatStore("someone-else", blob);
  assert.deepEqual((await other.manifest()).data.entries, {});
});

test("anonymous sync requests fail before reaching storage", async () => {
  const res = { setHeader() {}, end(body) { this.body = JSON.parse(body); } };
  await handler({ method: "GET", headers: {} }, res);
  assert.equal(res.statusCode, 401);
});

test("signed-in sync writes still require same-origin CSRF protection", async () => {
  const previous = { ...process.env };
  Object.assign(process.env, { APP_ORIGIN: "https://test.example", ALLOWED_EMAIL: "owner@example.com",
    SESSION_SECRET: "s".repeat(64), BLOB_READ_WRITE_TOKEN: "unused-test-token" });
  try {
    const cfg = settings();
    const token = await signSession({ sub: "owner", email: cfg.email, name: "Owner" }, cfg);
    const res = { setHeader() {}, end(body) { this.body = JSON.parse(body); } };
    await handler({ method: "POST", headers: { origin: cfg.origin,
      cookie: `${cookieNames(cfg).session}=${token}`, "content-type": "application/json" }, body: {} }, res);
    assert.equal(res.statusCode, 403);
  } finally {
    for (const key of ["APP_ORIGIN", "ALLOWED_EMAIL", "SESSION_SECRET", "BLOB_READ_WRITE_TOKEN"])
      if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
  }
});

test("a lost commit response retries without duplicating or losing the conversation", async () => {
  const { device } = setup(); const a = device([chat()]);
  const original = a.sync.request;
  a.sync.request = async (path, body) => {
    const result = await original(path, body);
    if (body?.action === "commit") throw new TypeError("Connection lost");
    return result;
  };
  await a.sync.tick(); assert.ok(a.issue);
  a.sync.request = original;
  await a.sync.tick();
  assert.equal(a.conflicts, 0); assert.equal(a.chats.length, 1); assert.equal(a.issue, "");
});

test("a streaming local reply is not replaced by a remote edit", async () => {
  const { device } = setup(); const a = device([chat()]), b = device();
  await a.sync.tick(); await b.sync.tick();
  a.sync.observe([{ ...chat(), title: "Remote rename" }]); await a.sync.tick();
  b.sync.observe([{ ...chat(), messages: [...chat().messages, { role: "assistant", text: "Streaming" }] }]);
  b.sync.busy = () => true;
  await b.sync.tick();
  assert.equal(b.sync.current.get("chat-one").messages.at(-1).text, "Streaming");
  assert.equal(b.conflicts, 0);
  b.sync.busy = () => false; await b.sync.tick();
  assert.equal(b.conflicts, 1); assert.equal(b.chats.length, 2);
});
