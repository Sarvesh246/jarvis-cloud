import test from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";
import { createWorkHandler } from "../api/work.js";
import { WorkStore } from "../server/work-store.js";
import { settings, signSession, cookieNames } from "../server/security.js";

const cfg = settings({ APP_ORIGIN: "https://work.example", ALLOWED_EMAIL: "owner@example.com", SESSION_SECRET: "s".repeat(64) });
const csrf = "a".repeat(64);
const user = { sub: "account-one", email: cfg.email, name: "Owner" };
function setup() {
  const files = new Map(); let etag = 0;
  const blob = {
    async get(path) { const value = files.get(path); return value ? { stream: new Response(value.text).body, blob: { etag: value.etag } } : null; },
    async put(path, text) { files.set(path, { text, etag: String(++etag) }); },
    async del(paths) { for (const path of [].concat(paths)) files.delete(path); },
  };
  let reads = 0;
  const handler = createWorkHandler({ configuration: () => cfg, configured: () => true,
    storeFactory: sub => { reads++; return new WorkStore(sub, blob, { engine: async () => ({ status: "unverified", summary: "Server result", result: {}, limitations: ["No remote source"] }) }); } });
  return { handler, get reads() { return reads; } };
}
async function request(token, overrides = {}) {
  return { method: "POST", url: "/api/work", headers: { origin: cfg.origin, cookie: `${cookieNames(cfg).session}=${token}; ${cookieNames(cfg).csrf}=${csrf}`,
    "x-csrf-token": csrf, "content-type": "application/json" }, body: {}, ...overrides };
}
function response() { return { headers: {}, setHeader(key, value) { this.headers[key] = value; }, end(text) { this.body = JSON.parse(text); } }; }

test("work API rejects anonymous, tampered and expired sessions before storage", async () => {
  const app = setup();
  const valid = await signSession(user, cfg);
  const expired = await new SignJWT({ email: cfg.email }).setProtectedHeader({ alg: "HS256" }).setSubject(user.sub)
    .setIssuer(cfg.origin).setAudience("jarvis-web").setExpirationTime(1).sign(new TextEncoder().encode(cfg.secret));
  for (const token of ["", `${valid}tampered`, expired]) {
    const res = response(); await app.handler(await request(token, { method: "GET" }), res); assert.equal(res.statusCode, 401);
  }
  assert.equal(app.reads, 0);
});

test("work mutation requires matching origin, CSRF and JSON even with a valid session", async () => {
  const app = setup(), token = await signSession(user, cfg), original = await request(token);
  for (const headers of [
    { ...original.headers, origin: "https://attacker.example" },
    { ...original.headers, "x-csrf-token": "" },
    { ...original.headers, "x-csrf-token": "b".repeat(64) },
    { ...original.headers, "content-type": "text/plain" },
  ]) {
    const res = response(); await app.handler({ ...original, headers }, res);
    assert.ok([403, 415].includes(res.statusCode));
  }
  assert.equal(app.reads, 0);
});

test("authenticated save/read/run/delete flow strips forged output and ignores requested account", async () => {
  const app = setup(), token = await signSession(user, cfg);
  const invoke = async overrides => { const res = response(); await app.handler(await request(token, overrides), res); return res; };
  const save = await invoke({ body: { action: "save", sub: "attacker", record: { id: "one", workspaceId: "refund", title: "Return", check: { id: "refund", input: {} }, documents: [{ id: "d", slot: "order", name: "receipt.txt", text: "Paid 20" }], output: { status: "completed" } }, base: null } });
  assert.equal(save.statusCode, 200); assert.equal(save.body.record.output, null);
  const read = await invoke({ method: "GET", url: "/api/work?id=one&sub=attacker" }); assert.deepEqual(read.body.record, save.body.record);
  assert.equal(read.body.documents, undefined, "document text only travels when asked for");
  const withText = await invoke({ method: "GET", url: "/api/work?id=one&documents=1" });
  assert.deepEqual(Object.values(withText.body.documents), ["Paid 20"]);
  const run = await invoke({ body: { action: "run", id: "one", base: save.body.record.revision, output: { status: "completed" } } });
  assert.equal(run.body.record.output.status, "unverified");
  const stale = await invoke({ body: { action: "delete", id: "one", base: save.body.record.revision } }); assert.equal(stale.statusCode, 409);
  const removed = await invoke({ body: { action: "delete", id: "one", base: run.body.record.revision } }); assert.equal(removed.body.record.deleted, true);
  const list = await invoke({ method: "GET" }); assert.deepEqual(list.body.records, []); assert.equal(list.headers["Cache-Control"], "no-store");
});

test("same email with a different authenticated subject has no access to another account", async () => {
  const app = setup(), owner = await signSession(user, cfg), other = await signSession({ ...user, sub: "account-two" }, cfg);
  const saved = response(); await app.handler(await request(owner, { body: { action: "save", record: { id: "one", workspaceId: "contract-review", title: "Private" }, base: null } }), saved);
  const res = response(); await app.handler(await request(other, { method: "GET", url: "/api/work?id=one" }), res); assert.equal(res.statusCode, 404);
});

test("missing Blob configuration honestly returns 503 and never invokes storage", async () => {
  let reached = false;
  const handler = createWorkHandler({ configuration: () => cfg, configured: () => false, storeFactory: () => { reached = true; } });
  const res = response(); await handler(await request(await signSession(user, cfg), { method: "GET" }), res);
  assert.equal(res.statusCode, 503); assert.match(res.body.error, /isn’t set up yet/); assert.equal(reached, false);
});

test("work API rejects damaged request bytes before saving and preserves valid Unicode", async () => {
  const app = setup(), token = await signSession(user, cfg);
  const invoke = async chunks => {
    const req = await request(token, { body: undefined });
    req[Symbol.asyncIterator] = async function* () { yield* chunks; };
    const res = response(); await app.handler(req, res); return res;
  };
  const payload = { action: "save", record: { id: "unicode", workspaceId: "refund", title: "日本語 🌦️", documents: [] } };
  const text = JSON.stringify(payload);
  const bad = Buffer.concat([Buffer.from(text.slice(0, text.indexOf("日本語"))), Buffer.from([0xff]), Buffer.from(text.slice(text.indexOf("日本語") + 3))]);
  const rejected = await invoke([bad]);
  assert.equal(rejected.statusCode, 400);
  assert.match(rejected.body.error, /Invalid JSON/);
  const before = response();
  await app.handler(await request(token, { method: "GET" }), before);
  assert.deepEqual(before.body.records, []);
  const good = Buffer.from(text);
  const saved = await invoke([...good].map(byte => Buffer.from([byte])));
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.body.record.title, payload.record.title);
  const after = response();
  await app.handler(await request(token, { method: "GET" }), after);
  assert.equal(after.body.records.length, 1);
  assert.equal(after.body.records[0].title, payload.record.title);
});
