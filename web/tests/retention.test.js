import test from "node:test";
import assert from "node:assert/strict";
import { AccountRecord } from "../server/account-record.js";
import { retentionApi } from "../server/account-api.js";
import { expiredChatIds, MAX_PER_PASS } from "../shared/retention.js";
import { memoryStorage, reply } from "./helpers-storage.js";

const DAY = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 9, 19);
const chat = (id, days, extra = {}) => ({ id, title: id, updated: now - days * DAY, messages: [{ id: "m", role: "user", content: "hi" }], ...extra });

test("only conversations older than the choice are named", () => {
  const chats = [chat("old", 100), chat("recent", 10), chat("edge", 29), chat("very-old", 400)];
  assert.deepEqual(expiredChatIds(chats, 30, { now }), ["very-old", "old"]);
  assert.deepEqual(expiredChatIds(chats, 90, { now }), ["very-old", "old"]);
  assert.deepEqual(expiredChatIds(chats, 365, { now }), ["very-old"]);
});

test("pinned, open, busy, running and empty conversations are never touched", () => {
  const chats = [
    chat("pinned", 500, { pinned: true }), chat("open", 500), chat("busy", 500), chat("writing", 500, { messages: [{ id: "a", role: "assistant", content: "", running: true }] }),
    chat("empty", 500, { messages: [] }), chat("gone", 500),
  ];
  assert.deepEqual(expiredChatIds(chats, 30, { now, activeId: "open", busyIds: ["busy"] }), ["gone"]);
});

test("no setting, a bad setting, a bad clock or malformed chats name nothing", () => {
  const chats = [chat("old", 500)];
  for (const days of [0, 7, 31, -30, NaN, "30", undefined]) assert.deepEqual(expiredChatIds(chats, days, { now }), []);
  assert.deepEqual(expiredChatIds(chats, 30, {}), []);
  assert.deepEqual(expiredChatIds(chats, 30, { now: NaN }), []);
  assert.deepEqual(expiredChatIds([null, {}, { id: "x", messages: [] }, { id: "y", messages: [{}], updated: "old" }, { id: "z", messages: [{}] }], 30, { now }), []);
  assert.deepEqual(expiredChatIds("nope", 30, { now }), []);
});

test("one pass removes at most a bounded number, oldest first", () => {
  const chats = Array.from({ length: MAX_PER_PASS + 10 }, (_, i) => chat(`c${i}`, 100 + i));
  const ids = expiredChatIds(chats, 30, { now });
  assert.equal(ids.length, MAX_PER_PASS);
  assert.equal(ids[0], `c${MAX_PER_PASS + 9}`);
});

const record = () => new AccountRecord("retention", {
  empty: () => ({ days: 0, confirmed: 0 }),
  check: value => { if (![0, 30, 90, 365].includes(value?.days)) throw new Error("Invalid retention record."); return value; },
}, memoryStorage());
const cfg = { origin: "https://vaelo.example" };
const csrf = "c".repeat(64);
const call = async (store, method, body) => {
  const res = reply();
  const req = { method, headers: { origin: cfg.origin, "x-csrf-token": csrf, cookie: `jarvis-csrf=${csrf}`, "content-type": "application/json" }, body };
  try { await retentionApi(req, res, cfg, { sub: "owner" }, store, () => now); } catch (error) { res.statusCode = error.status; res.body = { error: error.message }; }
  return res;
};

test("the choice is stored per account, needs an explicit confirmation, and reports the server's clock", async () => {
  const store = record();
  assert.deepEqual((await call(store, "GET")).body, { days: 0, now });
  let res = await call(store, "POST", { days: 90 });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /every device/);
  assert.equal((await call(store, "GET")).body.days, 0);
  res = await call(store, "POST", { days: 90, confirm: "yes" });
  assert.equal(res.statusCode, 400);
  res = await call(store, "POST", { days: 90, confirm: true });
  assert.deepEqual(res.body, { days: 90, now });
  assert.equal((await call(store, "GET")).body.days, 90);
  assert.equal((await call(store, "POST", { days: 7, confirm: true })).statusCode, 400);
  assert.equal((await call(store, "POST", { days: 0 })).body.days, 0);
  assert.equal((await call(store, "GET")).body.days, 0);
});

test("a cross-site request cannot change the retention choice", async () => {
  const store = record();
  const res = reply();
  await retentionApi({ method: "POST", headers: { origin: "https://evil.example", "x-csrf-token": csrf, cookie: `jarvis-csrf=${csrf}`, "content-type": "application/json" }, body: { days: 30, confirm: true } }, res, cfg, { sub: "owner" }, store, () => now)
    .catch(error => { res.statusCode = error.status; });
  assert.equal(res.statusCode, 403);
  assert.equal((await call(store, "GET")).body.days, 0);
});
