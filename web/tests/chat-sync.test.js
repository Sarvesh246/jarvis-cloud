import test from "node:test";
import { devices } from "../server/devices.js";
import { memoryStorage as registryStorage } from "./helpers-storage.js";
import assert from "node:assert/strict";
import { BlobPreconditionFailedError } from "@vercel/blob";
import { ChatStore, accountPath } from "../server/chat-store.js";
import { ChatSync, liveReply, mergeChats, readSyncCache } from "../src/lib/chat-sync.js";
import handler from "../api/chats.js";
import { settings, signSession, cookieNames } from "../server/security.js";
import { revocations } from "../server/revocation.js";

function memoryBlob() {
  const files = new Map();
  let version = 0;
  return {
    files,
    async del(paths) { for (const path of paths) files.delete(path); },
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

test("one failed download does not prevent other conversations from syncing", async () => {
  const { device } = setup();
  const remote = device([chat('broken'), chat('healthy')]);
  await remote.sync.tick();
  const local = device([chat('local')]);
  const request = local.sync.request;
  local.sync.request = async (path, body) => {
    if (path.includes('id=broken')) throw new Error('Temporary read failure');
    return request(path, body);
  };
  await local.sync.tick();
  assert.ok(local.chats.some(item => item.id === 'healthy'));
  assert.equal(local.sync.dirty('local'), false, 'independent local work is uploaded');
  assert.ok(local.issue, 'the failed download remains visible');
  assert.equal(local.sync.base.broken, undefined, 'a failed read is never acknowledged');
  local.sync.request = request;
  await local.sync.tick();
  assert.ok(local.chats.some(item => item.id === 'broken'));
  assert.equal(local.issue, '');
  local.sync.stop(); remote.sync.stop();
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
  assert.equal(await store.read(store.partPath("one", "v-one", 0)), null);
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
    SESSION_SECRET: "s".repeat(64), DATABASE_URL: "postgres://unused" });
  const realStorage = revocations.storage;
  revocations.storage = { async get() { return null; } }; // never signed out
  const realDevices = devices.record.storage;
  devices.record.storage = registryStorage(); // the device registry needs a store too
  try {
    const cfg = settings();
    const token = await signSession({ sub: "owner", email: cfg.email, name: "Owner" }, cfg);
    const res = { setHeader() {}, end(body) { this.body = JSON.parse(body); } };
    await handler({ method: "POST", headers: { origin: cfg.origin,
      cookie: `${cookieNames(cfg).session}=${token}`, "content-type": "application/json" }, body: {} }, res);
    assert.equal(res.statusCode, 403);
  } finally {
    revocations.storage = realStorage;
    devices.record.storage = realDevices;
    devices.cache.clear();
    for (const key of ["APP_ORIGIN", "ALLOWED_EMAIL", "SESSION_SECRET", "DATABASE_URL"])
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

const reply = (extra = {}) => ({ id: "reply-one", role: "assistant", content: "", run: "reply-one",
  running: true, startedAt: Date.now(), ...extra });

test("concurrent reply version selections keep both histories instead of discarding the local choice", async () => {
  const { device } = setup();
  const versions = [{ content: "First answer" }, { content: "Second answer" }];
  const original = { ...chat(), messages: [...chat().messages,
    reply({ ...versions[1], versions, version: 1, running: undefined })] };
  const desktop = device([original]), phone = device();
  await desktop.sync.tick(); await phone.sync.tick();
  // Desktop continues the conversation while an offline phone selects an older answer.
  desktop.sync.observe([{ ...original, messages: [...original.messages,
    { id: "next", role: "user", content: "Tell me more" }] }]);
  phone.sync.observe([{ ...original, messages: [...chat().messages,
    { ...original.messages[1], ...versions[0], version: 0 }] }]);
  await desktop.sync.tick(); await phone.sync.tick();
  assert.equal(phone.conflicts, 1);
  assert.equal(phone.chats.length, 2);
  assert.equal(phone.chats.find(item => item.id !== original.id).messages[1].content, "First answer");
  const third = device(); await third.sync.tick();
  assert.equal(third.chats.length, 2);
  assert.equal(third.chats.find(item => item.id === original.id).messages.at(-1).content, "Tell me more");
});

test("matching message IDs cannot merge changed user text or different relay runs", () => {
  assert.equal(mergeChats(chat(), chat("chat-one", "Changed text")), null);
  const original = { ...chat(), messages: [reply()] };
  assert.equal(mergeChats(original, { ...original,
    messages: [{ ...original.messages[0], run: "other-run", content: "Other answer" }] }), null);
});

test("a reply being written is saved when it starts and ends, not on every word", async () => {
  const { device, store } = setup();
  const a = device([chat()]); await a.sync.tick();
  const writes = async () => (await store.manifest()).data.entries["chat-one"].version;
  const started = { ...chat(), messages: [...chat().messages, reply()] };
  a.sync.observe([started]); a.sync.push("chat-one"); await a.sync.tick();
  const atStart = await writes();
  const phone = device(); await phone.sync.tick();
  assert.equal(phone.chats[0].messages.at(-1).running, true);
  // Streaming words stay on this device; the phone follows them from the relay.
  a.sync.observe([{ ...started, messages: [...chat().messages, reply({ content: "Half" })] }]);
  await a.sync.tick();
  assert.equal(await writes(), atStart);
  a.sync.observe([{ ...started, messages: [...chat().messages, reply({ content: "Done", running: undefined })] }]);
  await a.sync.tick(); await phone.sync.tick();
  assert.notEqual(await writes(), atStart);
  assert.equal(phone.chats[0].messages.at(-1).content, "Done");
});

test("a device that followed a reply takes the sender's finished copy without a device copy", async () => {
  const { device } = setup();
  const started = { ...chat(), messages: [...chat().messages, reply()] };
  const a = device([started]); a.sync.push("chat-one"); await a.sync.tick();
  const phone = device(); await phone.sync.tick();
  // The phone fills in the reply as it follows it, still marked as running.
  phone.sync.observe([{ ...started, messages: [...chat().messages, reply({ content: "Followed" })] }]);
  a.sync.observe([{ ...started, messages: [...chat().messages, reply({ content: "Final", running: undefined })] }]);
  await a.sync.tick(); await phone.sync.tick();
  assert.equal(phone.conflicts, 0);
  assert.equal(phone.chats.length, 1);
  assert.equal(phone.chats[0].messages.at(-1).content, "Final");
  assert.equal(phone.sync.dirty("chat-one"), false);
});

test("a message sent on one device while the other finished a reply is merged, not copied", async () => {
  const done = { ...chat(), messages: [...chat().messages, reply({ content: "Answer", running: undefined })] };
  assert.deepEqual(mergeChats(
    { ...chat(), messages: [...done.messages, { id: "next", role: "user", text: "More" }] },
    done,
  ).messages.map((message) => message.id), ["message-one", "reply-one", "next"]);
  assert.equal(mergeChats(
    { ...chat(), messages: [{ id: "other", role: "user", text: "Different" }] }, chat(),
  ), null);
  assert.equal(liveReply({ messages: [reply({ startedAt: Date.now() - 2 * 60 * 60 * 1000 })] }), null);
});

for (const failedAction of ["part", "commit"]) {
  test(`a failed live-reply ${failedAction} is retried while the reply is still running`, async () => {
    const { device } = setup();
    const a = device([chat()]); await a.sync.tick();
    const started = { ...chat(), messages: [...chat().messages, reply()] };
    const original = a.sync.request;
    let failed = false;
    a.sync.request = async (path, body) => {
      if (!failed && body?.action === failedAction) {
        failed = true;
        throw new TypeError("Connection lost");
      }
      return original(path, body);
    };
    // Queue directly so the test controls each pass without push's timer.
    a.sync.forced.add("chat-one");
    a.sync.current.set("chat-one", started);
    await a.sync.tick();
    assert.ok(a.issue);
    await a.sync.tick();
    const phone = device(); await phone.sync.tick();
    assert.equal(phone.chats[0].messages.at(-1).run, started.messages.at(-1).run);
    assert.equal(phone.chats[0].messages.at(-1).running, true);
    assert.equal(a.issue, "");
    assert.equal(a.sync.forced.size, 0);
    a.sync.stop(); phone.sync.stop();
  });
}

test("a new live save queued during an upload survives that upload's acknowledgement", async () => {
  const { device } = setup();
  const a = device([chat()]); await a.sync.tick();
  const started = { ...chat(), messages: [...chat().messages, reply()] };
  a.sync.current.set("chat-one", started);
  a.sync.forced.add("chat-one");
  const original = a.sync.request;
  let queued = false;
  a.sync.request = async (path, body) => {
    if (!queued && body?.action === "part") {
      queued = true;
      a.sync.current.set("chat-one", { ...started,
        messages: [...chat().messages, reply({ run: "continued-run" })] });
      a.sync.forced.add("chat-one");
    }
    return original(path, body);
  };
  await a.sync.tick();
  assert.equal(a.sync.forced.has("chat-one"), true);
  await a.sync.tick();
  const phone = device(); await phone.sync.tick();
  assert.equal(phone.chats[0].messages.at(-1).run, "continued-run");
  a.sync.stop(); phone.sync.stop();
});
