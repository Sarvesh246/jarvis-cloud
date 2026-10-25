import test from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";
import { createWorkHandler } from "../api/work.js";
import { WorkStore } from "../server/work-store.js";
import { runCheck } from "../server/check-engine.js";
import { settings, signSession, cookieNames } from "../server/security.js";

const cfg = settings({ APP_ORIGIN: "https://work.example", ALLOWED_EMAIL: "owner@example.com", SESSION_SECRET: "s".repeat(64) });
const csrf = "a".repeat(64);
const user = { sub: "account-one", email: cfg.email, name: "Owner" };
function setup(engine = async () => ({ status: "unverified", summary: "Server result", result: {}, limitations: ["No remote source"] })) {
  const files = new Map(); let etag = 0;
  const blob = {
    async get(path) { const value = files.get(path); return value ? { stream: new Response(value.text).body, blob: { etag: value.etag } } : null; },
    async put(path, text) { files.set(path, { text, etag: String(++etag) }); },
    async del(paths) { for (const path of [].concat(paths)) files.delete(path); },
  };
  let reads = 0;
  const handler = createWorkHandler({ configuration: () => cfg, configured: () => true,
    storeFactory: sub => { reads++; return new WorkStore(sub, blob, { engine }); } });
  return { handler, get reads() { return reads; } };
}
async function request(token, overrides = {}) {
  return { method: "POST", url: "/api/work", headers: { origin: cfg.origin, cookie: `${cookieNames(cfg).session}=${token}; ${cookieNames(cfg).csrf}=${csrf}`,
    "x-csrf-token": csrf, "content-type": "application/json" }, body: {}, ...overrides };
}
function response() { return { headers: {}, setHeader(key, value) { this.headers[key] = value; }, end(text) { this.body = JSON.parse(text); } }; }

test("ambiguous terms preserve saved answers and revisions until corrected", async () => {
  const app = setup(runCheck), token = await signSession(user, cfg);
  const otherToken = await signSession({ ...user, sub: 'account-two' }, cfg);
  const invoke = async (body, session = token) => {
    const res = response(); await app.handler(await request(session, { body }), res); return res;
  };
  for (const side of ['before', 'after']) {
    const input = { before: 'Rent: $1,500', after: 'Rent: $1,500', [side]: 'Rent: $1,620\nrent: $1,500' };
    const saved = await invoke({ action: 'save', base: null, record: {
      id: `terms-${side}`, workspaceId: 'lease-review', title: 'Lease terms', documents: [],
      check: { id: 'terms-change', input },
    } });
    assert.equal(saved.statusCode, 200);
    const body = { action: 'run', id: saved.body.record.id, base: saved.body.record.revision };
    for (let attempt = 0; attempt < 2; attempt++) {
      const rejected = await invoke(body);
      assert.equal(rejected.statusCode, 400);
      assert.match(rejected.body.error, /Line 2 .*“rent”.*only once/);
      const read = response();
      await app.handler(await request(token, { method: 'GET', url: `/api/work?id=${body.id}` }), read);
      assert.deepEqual(read.body.record, saved.body.record, 'rejection cannot store a false result or change the revision');
    }
    assert.equal((await invoke(body, otherToken)).statusCode, 404);
    const corrected = await invoke({ action: 'save', base: saved.body.record.revision,
      record: { ...saved.body.record, check: { id: 'terms-change', input: { before: 'Rent: $1,500', after: 'Rent: $1,620' } } } });
    assert.equal(corrected.statusCode, 200);
    const run = await invoke({ ...body, base: corrected.body.record.revision });
    assert.equal(run.statusCode, 200);
    assert.deepEqual(run.body.record.output.result.changes, [{ term: 'Rent', before: '$1,500', after: '$1,620' }]);
    const read = response();
    await app.handler(await request(token, { method: 'GET', url: `/api/work?id=${body.id}` }), read);
    assert.deepEqual(read.body.record, run.body.record);
  }
});

test("group choice duplicate rejection preserves saved answers and recovers after correction", async () => {
  const app = setup(runCheck), token = await signSession(user, cfg);
  const invoke = async body => {
    const res = response(); await app.handler(await request(token, { body }), res); return res;
  };
  for (const [id, input] of [
    ["preferences", { people: "Ana: Friday, Saturday, Friday\nBen: Friday, Saturday" }],
    ["options", { people: "Ana: Friday, Saturday\nBen: Friday, Saturday", choices: "Friday, Saturday, FRIDAY" }],
  ]) {
    const saved = await invoke({ action: "save", base: null, record: {
      id, workspaceId: "group-plans", title: "Weekend plans", documents: [],
      check: { id: "group-choice", input },
    } });
    assert.equal(saved.statusCode, 200);
    const rejected = await invoke({ action: "run", id, base: saved.body.record.revision });
    assert.equal(rejected.statusCode, 400);
    assert.match(rejected.body.error, /listed only once/);
    const unchanged = response();
    await app.handler(await request(token, { method: "GET", url: `/api/work?id=${id}` }), unchanged);
    assert.deepEqual(unchanged.body.record, saved.body.record, "rejection retains answers and revision without saving a false result");
    const corrected = await invoke({ action: "save", base: saved.body.record.revision,
      record: { ...saved.body.record, check: { id: "group-choice", input: {
        people: "Ana: Friday, Saturday\nBen: Friday, Saturday", choices: "Friday, Saturday",
      } } } });
    assert.equal(corrected.statusCode, 200);
    const run = await invoke({ action: "run", id, base: corrected.body.record.revision });
    assert.equal(run.statusCode, 200);
    assert.deepEqual(run.body.record.output.result, { status: "proposed", choice: "Friday", alsoWorks: ["Saturday"] });
    const reread = response();
    await app.handler(await request(token, { method: "GET", url: `/api/work?id=${id}` }), reread);
    assert.deepEqual(reread.body.record.output, run.body.record.output);
  }
});

test("purchase duration rejection preserves saved answers and allows a corrected run", async () => {
  const app = setup(runCheck), token = await signSession(user, cfg);
  const invoke = async body => {
    const res = response(); await app.handler(await request(token, { body }), res); return res;
  };
  const saved = await invoke({ action: "save", base: null, record: {
    id: "printer", workspaceId: "compare-buy", title: "Printer comparison", documents: [],
    check: { id: "purchase", input: { options: "Printer 2000 $200, $20 a year\nPrinter 3000 $250, $5 a year", years: "3 weeks", budget: "$270" } },
  } });
  assert.equal(saved.statusCode, 200);
  const rejected = await invoke({ action: "run", id: "printer", base: saved.body.record.revision });
  assert.equal(rejected.statusCode, 400);
  assert.match(rejected.body.error, /how long/);
  const read = response();
  await app.handler(await request(token, { method: "GET", url: "/api/work?id=printer" }), read);
  assert.deepEqual(read.body.record, saved.body.record);
  const corrected = await invoke({ action: "save", base: saved.body.record.revision,
    record: { ...saved.body.record, check: { ...saved.body.record.check, input: { ...saved.body.record.check.input, years: "3 years" } } } });
  assert.equal(corrected.statusCode, 200);
  const run = await invoke({ action: "run", id: "printer", base: corrected.body.record.revision });
  assert.equal(run.statusCode, 200);
  assert.equal(run.body.record.output.result.best, "Printer 2000");
  assert.deepEqual(run.body.record.output.result.options.map(item => item.total), [260, 265]);
  const reread = response();
  await app.handler(await request(token, { method: "GET", url: "/api/work?id=printer" }), reread);
  assert.deepEqual(reread.body.record.output, run.body.record.output);
});

test("cost checks reject invalid sharing without saving a result and recover after correction", async () => {
  const app = setup(runCheck), token = await signSession(user, cfg);
  const invoke = async body => {
    const res = response(); await app.handler(await request(token, { body }), res); return res;
  };
  const initial = await invoke({ action: "save", base: null, record: {
    id: "trip", workspaceId: "split-costs", title: "Trip expenses", documents: [],
    check: { id: "cost-split", input: { people: "Ana Smith, Ben Jones", spent: "Ana Smith paid $10 ()" } },
  } });
  assert.equal(initial.statusCode, 200);
  const rejected = await invoke({ action: "run", id: "trip", base: initial.body.record.revision });
  assert.equal(rejected.statusCode, 400);
  assert.match(rejected.body.error, /at least one person/);
  const read = response();
  await app.handler(await request(token, { method: "GET", url: "/api/work?id=trip" }), read);
  assert.deepEqual(read.body.record, initial.body.record, "failed calculation leaves the saved answers and revision intact");
  const corrected = await invoke({ action: "save", base: initial.body.record.revision,
    record: { ...initial.body.record, check: { id: "cost-split", input: { people: "Ana Smith, Ben Jones", spent: "Ana Smith paid $10" } } } });
  assert.equal(corrected.statusCode, 200);
  const run = await invoke({ action: "run", id: "trip", base: corrected.body.record.revision });
  assert.equal(run.statusCode, 200);
  assert.deepEqual(run.body.record.output.result.payments, [{ from: "Ben Jones", to: "Ana Smith", amount: 5 }]);
  const reread = response();
  await app.handler(await request(token, { method: "GET", url: "/api/work?id=trip" }), reread);
  assert.deepEqual(reread.body.record.output, run.body.record.output);
});

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
