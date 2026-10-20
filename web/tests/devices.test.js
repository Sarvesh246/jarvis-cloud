import test from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";
import { settings, signSession, sessionUser, cookieNames } from "../server/security.js";
import { DeviceRegistry, deviceLabel } from "../server/devices.js";
import { Revocations } from "../server/revocation.js";
import { createDevicesHandler } from "../server/devices-api.js";
import { memoryStorage, reply } from "./helpers-storage.js";

const owner = { sub: "google-user-123", email: "owner@gmail.com", name: "Owner" };
const csrf = "a".repeat(64);
const base = settings({ APP_ORIGIN: "https://vaelo.example", GOOGLE_CLIENT_ID: "x", ALLOWED_EMAIL: owner.email, SESSION_SECRET: "x".repeat(64) });

function world() {
  const store = memoryStorage();
  let time = Date.now();
  const clock = { now: () => time, enabled: () => true };
  const cfg = { ...base, devices: new DeviceRegistry(store, clock), revocations: new Revocations(store, clock) };
  return { store, cfg, clock, advance: ms => { time += ms; } };
}
const asWeb = token => ({ headers: { cookie: `${cookieNames(base).session}=${token}; ${cookieNames(base).csrf}=${csrf}`, origin: base.origin, "x-csrf-token": csrf, "content-type": "application/json" } });
const asDesktop = token => ({ headers: { authorization: `Bearer ${token}`, "content-type": "application/json" } });
const signIn = (cfg, label, audience = "jarvis-web") => signSession(owner, cfg, audience, { label });
const legacyToken = (cfg, issuedAt) => new SignJWT({ email: owner.email, name: owner.name }).setProtectedHeader({ alg: "HS256" })
  .setSubject(owner.sub).setIssuer(cfg.origin).setAudience("jarvis-web").setIssuedAt(issuedAt).setExpirationTime("7d").sign(new TextEncoder().encode(cfg.secret));

test("device labels are readable and never keep the user agent", () => {
  assert.equal(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36"), "Chrome on Windows");
  assert.equal(deviceLabel("Mozilla/5.0 (Windows NT 10.0) Chrome/126.0 Safari/537.36 Edg/126.0", "jarvis-web"), "Edge on Windows");
  assert.equal(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Safari/604.1"), "Safari on iOS");
  assert.equal(deviceLabel("Mozilla/5.0 (Windows NT 10.0) WebView2", "vaelo-desktop"), "Windows app");
  assert.equal(deviceLabel("", "vaelo-desktop"), "Desktop app");
  assert.equal(deviceLabel(undefined), "Web browser");
});

test("a signed-in device is listed, and signing out one device refuses only its token", async () => {
  const { cfg } = world();
  const laptop = await signIn(cfg, "Chrome on Windows");
  const app = await signIn(cfg, "Windows app", "vaelo-desktop");
  const phone = await signIn(cfg, "Safari on iOS");
  assert.equal((await sessionUser(asWeb(laptop), cfg)).sub, owner.sub);
  assert.equal((await sessionUser(asDesktop(app), cfg)).sub, owner.sub);
  const listed = await cfg.devices.list(owner.sub);
  assert.deepEqual(listed.map(d => d.label).sort(), ["Chrome on Windows", "Safari on iOS", "Windows app"]);
  await cfg.devices.revoke(owner.sub, listed.find(d => d.label === "Safari on iOS").id);
  assert.equal(await sessionUser(asWeb(phone), cfg), null);
  assert.ok(await sessionUser(asWeb(laptop), cfg));
  assert.ok(await sessionUser(asDesktop(app), cfg));
});

test("signing out the other devices keeps this one and ends older tokens without a device id", async () => {
  const { cfg, advance } = world();
  const legacy = await legacyToken(cfg, Math.floor(Date.now() / 1000) - 60);
  assert.ok(await sessionUser(asWeb(legacy), cfg), "tokens from before devices existed work until others are signed out");
  const here = await signIn(cfg, "Chrome on Windows");
  const other = await signIn(cfg, "Firefox on Linux");
  const hereId = (await cfg.devices.list(owner.sub)).find(d => d.label === "Chrome on Windows").id;
  advance(1000);
  await cfg.devices.revokeOthers(owner.sub, hereId);
  assert.ok(await sessionUser(asWeb(here), cfg));
  assert.equal(await sessionUser(asWeb(other), cfg), null);
  assert.equal(await sessionUser(asWeb(legacy), cfg), null);
});

test("an unreadable device record refuses the session instead of trusting it", async () => {
  const { cfg, store } = world();
  const token = await signIn(cfg, "Chrome on Windows");
  const fresh = { ...cfg, devices: new DeviceRegistry(store, { enabled: () => true }) };
  assert.ok(await sessionUser(asWeb(token), fresh));
  const path = [...store.rows.keys()].find(key => key.startsWith("devices/"));
  store.rows.set(path, { text: "{\"devices\":[]}", etag: "bad" });
  const broken = { ...cfg, devices: new DeviceRegistry(store, { enabled: () => true }) };
  assert.equal(await sessionUser(asWeb(token), broken), null);
  const down = { ...cfg, devices: new DeviceRegistry({ async get() { throw new Error("storage down"); }, async put() { assert.fail("must not write"); } }, { enabled: () => true }) };
  assert.equal(await sessionUser(asWeb(token), down), null);
});

test("a sign-in fails when the device cannot be recorded, and a token with a bad id is refused", async () => {
  const { cfg } = world();
  const failing = { ...cfg, devices: new DeviceRegistry({ async get() { return null; }, async put() { throw new Error("storage down"); } }, { enabled: () => true }) };
  await assert.rejects(signIn(failing, "Chrome on Windows"), /storage down/);
  const key = new TextEncoder().encode(cfg.secret);
  const withId = did => new SignJWT({ email: owner.email, did }).setProtectedHeader({ alg: "HS256" })
    .setSubject(owner.sub).setIssuer(cfg.origin).setAudience("jarvis-web").setIssuedAt().setExpirationTime("7d").sign(key);
  assert.equal(await sessionUser(asWeb(await withId("../../etc")), cfg), null);
  assert.equal(await sessionUser(asWeb(await withId("AAAAAAAAAAAAAAAA")), cfg), null);
});

test("a desktop token cannot be used as a web token, or the reverse, even with a real device id", async () => {
  const { cfg } = world();
  const app = await signIn(cfg, "Windows app", "vaelo-desktop");
  assert.equal(await sessionUser(asWeb(app), cfg), null);
});

test("the oldest idle devices drop off at the cap and expired entries are dropped", async () => {
  const { cfg, advance } = world();
  const first = await signIn(cfg, "First");
  for (let i = 0; i < 20; i++) { advance(1000); await signIn(cfg, `Device ${i}`); }
  const labels = (await cfg.devices.list(owner.sub)).map(d => d.label);
  assert.equal(labels.length, 20);
  assert.ok(!labels.includes("First"));
  assert.equal(await sessionUser(asWeb(first), cfg), null);
  advance(8 * 24 * 3600 * 1000);
  assert.equal((await cfg.devices.list(owner.sub)).length, 0);
});

test("the devices endpoint lists, refuses self sign-out, and signs out the others", async () => {
  const { cfg } = world();
  const handler = createDevicesHandler({ configuration: () => cfg, devices: cfg.devices, epochs: cfg.revocations });
  const here = await signIn(cfg, "Chrome on Windows");
  const other = await signIn(cfg, "Windows app", "vaelo-desktop");
  const post = (token, body, headers = {}) => ({ method: "POST", ...asWeb(token), headers: { ...asWeb(token).headers, ...headers }, body });
  let res = reply();
  await handler({ method: "GET", ...asWeb(here) }, res);
  assert.equal(res.body.devices.length, 2);
  assert.deepEqual(res.body.devices.map(d => [d.label, d.kind, d.current]), [["Chrome on Windows", "web", true], ["Windows app", "desktop", false]]);
  assert.deepEqual(Object.keys(res.body.devices[0]).sort(), ["created", "current", "id", "kind", "label", "seen"]);
  const hereId = res.body.current;
  const otherId = res.body.devices[1].id;
  res = reply();
  await handler(post(here, { action: "revoke", id: hereId }), res);
  assert.equal(res.statusCode, 400);
  res = reply();
  await handler(post(here, { action: "revoke-others" }, { origin: "https://evil.example" }), res);
  assert.equal(res.statusCode, 403);
  assert.ok(await sessionUser(asDesktop(other), cfg));
  res = reply();
  await handler(post(here, { action: "revoke", id: otherId }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(await sessionUser(asDesktop(other), cfg), null);
  const again = await signIn(cfg, "Firefox on Linux");
  res = reply();
  await handler(post(here, { action: "revoke-others" }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(await sessionUser(asWeb(again), cfg), null);
  assert.ok(await sessionUser(asWeb(here), cfg));
  res = reply();
  await handler({ method: "GET", headers: {} }, res);
  assert.equal(res.statusCode, 401);
});

test("an older session without a device id cannot manage devices, and a full sign-out hides dead entries", async () => {
  const { cfg, advance } = world();
  const handler = createDevicesHandler({ configuration: () => cfg, devices: cfg.devices, epochs: cfg.revocations });
  const legacy = await legacyToken(cfg, Math.floor(Date.now() / 1000));
  let res = reply();
  await handler({ method: "POST", ...asWeb(legacy), body: { action: "revoke-others" } }, res);
  assert.equal(res.statusCode, 409);
  await signIn(cfg, "Old browser");
  advance(2000);
  await cfg.revocations.revoke(owner.sub, "jarvis-web");
  advance(2000);
  const here = await signIn(cfg, "Chrome on Windows");
  res = reply();
  await handler({ method: "GET", ...asWeb(here) }, res);
  assert.deepEqual(res.body.devices.map(d => d.label), ["Chrome on Windows"]);
});

test("without storage nothing changes: no registry, no device id in the token", async () => {
  const cfg = { ...base, devices: new DeviceRegistry(memoryStorage(), { enabled: () => false }) };
  const token = await signIn(cfg, "Chrome on Windows");
  assert.equal(JSON.parse(Buffer.from(token.split(".")[1], "base64url")).did, undefined);
  assert.ok(await sessionUser(asWeb(token), cfg));
});
