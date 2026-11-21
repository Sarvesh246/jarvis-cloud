import test from "node:test";
import assert from "node:assert/strict";
import { settings, signSession, sessionUser, cookieNames, csrfToken, renewedSessionCookie, RENEW_AFTER } from "../server/security.js";
import { DeviceRegistry } from "../server/devices.js";
import { Revocations } from "../server/revocation.js";
import { memoryStorage } from "./helpers-storage.js";

/* People were signed out every seven days no matter how often they used
   Vaelo: the browser session was a fixed week from sign-in and never renewed.
   Opening Vaelo now re-issues a day-old session for this same device. */

const owner = { sub: "google-user-123", email: "owner@gmail.com", name: "Owner" };
const base = settings({ APP_ORIGIN: "https://vaelo.example", GOOGLE_CLIENT_ID: "x", ALLOWED_EMAIL: owner.email, SESSION_SECRET: "x".repeat(64) });
const DAY_MS = RENEW_AFTER * 1000;

function world() {
  const store = memoryStorage();
  let time = Date.now();
  const clock = { now: () => time, enabled: () => true };
  const cfg = { ...base, devices: new DeviceRegistry(store, clock), revocations: new Revocations(store, clock) };
  return { cfg, advance: ms => { time += ms; } };
}
const asWeb = token => ({ headers: { cookie: `${cookieNames(base).session}=${token}` } });
const asDesktop = token => ({ headers: { authorization: `Bearer ${token}` } });
const tokenOf = cookie => cookie.match(new RegExp(`^${cookieNames(base).session}=([^;]+)`))[1];

test("a fresh browser session is left alone", async () => {
  const { cfg } = world();
  const req = asWeb(await signSession(owner, cfg, "jarvis-web", { label: "Safari on iOS" }));
  const user = await sessionUser(req, cfg);
  assert.equal(await renewedSessionCookie(req, user, cfg), null);
});

test("a day-old browser session is renewed for the same device and keeps working", async () => {
  const { cfg, advance } = world();
  const old = await signSession(owner, cfg, "jarvis-web", { label: "Safari on iOS" });
  const req = asWeb(old);
  const user = await sessionUser(req, cfg);
  advance(DAY_MS + 1000);
  const cookie = await renewedSessionCookie(req, user, cfg, Date.now() + DAY_MS + 1000);
  assert.ok(cookie, "a used session older than a day is re-issued");
  assert.match(cookie, /HttpOnly; SameSite=Lax; Max-Age=604800; Secure/);
  const renewed = asWeb(tokenOf(cookie));
  assert.equal((await sessionUser(renewed, cfg)).sub, owner.sub);
  const listed = await cfg.devices.list(owner.sub);
  assert.equal(listed.length, 1, "renewal keeps one device entry instead of adding another");
  assert.ok(listed[0].issued * 1000 >= Date.now() + DAY_MS, "the entry outlives the original week");
});

test("a device signed out from Settings cannot renew itself back in", async () => {
  const { cfg, advance } = world();
  const req = asWeb(await signSession(owner, cfg, "jarvis-web", { label: "Safari on iOS" }));
  const user = await sessionUser(req, cfg);
  const [entry] = await cfg.devices.list(owner.sub);
  await cfg.devices.revoke(owner.sub, entry.id);
  advance(DAY_MS + 1000);
  assert.equal(await renewedSessionCookie(req, user, cfg, Date.now() + DAY_MS + 1000), null);
});

test("opening Vaelo refreshes the CSRF cookie's lifetime without changing its value", () => {
  const headers = {};
  const res = { setHeader: (key, value) => { headers[key] = value; } };
  const token = "b".repeat(64);
  assert.equal(csrfToken({ headers: { cookie: `${cookieNames(base).csrf}=${token}` } }, res, base), token);
  assert.match(headers["Set-Cookie"], new RegExp(`^${cookieNames(base).csrf}=${token}; .*Max-Age=604800`));
});

test("guests and desktop bearer tokens are never renewed as browser cookies", async () => {
  const { cfg } = world();
  const later = Date.now() + DAY_MS + 1000;
  const desktopReq = asDesktop(await signSession(owner, cfg, "vaelo-desktop", { label: "Windows app" }));
  const desktopUser = await sessionUser(desktopReq, cfg);
  assert.equal(await renewedSessionCookie(desktopReq, desktopUser, cfg, later), null);
  assert.equal(await renewedSessionCookie(asWeb("x"), { sub: "guest:1", guest: true }, cfg, later), null);
  assert.equal(await renewedSessionCookie(asWeb("x"), null, cfg, later), null);
});
