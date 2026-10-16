import test from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";
import {
  settings,
  signSession,
  sessionUser,
  sameOrigin,
  googleUser,
  cookieNames,
} from "../server/security.js";
import { chatInput } from "../server/chat.js";
import handler from "../api/chat.js";

const cfg = settings({
  APP_ORIGIN: "https://jarvis.example",
  GOOGLE_CLIENT_ID: "test.apps.googleusercontent.com",
  ALLOWED_EMAIL: "owner@gmail.com",
  SESSION_SECRET: "x".repeat(64),
});
const user = {
  sub: "google-user-123",
  email: "owner@gmail.com",
  name: "Owner",
};
const csrf = "a".repeat(64);
const request = (token) => ({
  headers: {
    cookie: `${cookieNames(cfg).session}=${token}; ${cookieNames(cfg).csrf}=${csrf}`,
    origin: cfg.origin,
    "x-csrf-token": csrf,
    "content-type": "application/json",
  },
});

test("only a valid owner session is accepted; tampering and expiry are rejected", async () => {
  const token = await signSession(user, cfg);
  assert.deepEqual(await sessionUser(request(token), cfg), user);
  assert.equal(await sessionUser(request(token + "x"), cfg), null);
  assert.equal(
    await sessionUser(request(token), { ...cfg, email: "other@gmail.com" }),
    null,
  );
  const expired = await new SignJWT(user)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.sub)
    .setIssuer(cfg.origin)
    .setAudience("jarvis-web")
    .setExpirationTime(1)
    .sign(new TextEncoder().encode(cfg.secret));
  assert.equal(await sessionUser(request(expired), cfg), null);
});

test("cross-origin requests and missing or mismatched CSRF tokens are rejected", () => {
  const req = request("dummy");
  assert.doesNotThrow(() => sameOrigin(req, cfg));
  assert.throws(
    () =>
      sameOrigin(
        { headers: { ...req.headers, origin: "https://other.example" } },
        cfg,
      ),
    /origin/,
  );
  assert.throws(
    () => sameOrigin({ headers: { ...req.headers, "x-csrf-token": "" } }, cfg),
    /Refresh/,
  );
  assert.throws(
    () =>
      sameOrigin(
        { headers: { ...req.headers, "x-csrf-token": "b".repeat(64) } },
        cfg,
      ),
    /Refresh/,
  );
});

test("Google claims must belong to the verified owner and login nonce", () => {
  const claims = {
    ...user,
    given_name: "Owner",
    email_verified: true,
    nonce: csrf,
  };
  assert.deepEqual(googleUser(claims, csrf, cfg), user);
  for (const changed of [
    { email: "attacker@gmail.com" },
    { email_verified: false },
    { nonce: "wrong" },
    { sub: "" },
  ]) {
    assert.throws(
      () => googleUser({ ...claims, ...changed }, csrf, cfg),
      /private/,
    );
  }
});

test("account names come from Google without a hard-coded personal fallback", () => {
  const claims = {
    sub: user.sub,
    email: user.email,
    email_verified: true,
    nonce: csrf,
  };
  assert.equal(
    googleUser({ ...claims, given_name: "Maya" }, csrf, cfg).name,
    "Maya",
  );
  assert.equal(
    googleUser({ ...claims, name: "Renée Lee" }, csrf, cfg).name,
    "Renée Lee",
  );
  assert.equal(googleUser(claims, csrf, cfg).name, "User");
  assert.equal(
    googleUser({ ...claims, given_name: "  Maya\nLee  " }, csrf, cfg).name,
    "Maya Lee",
  );
});

test("chat input rejects model/system overrides, oversized context and invalid conversations", () => {
  const body = {
    conversationId: "c5ec5f03-1fd1-4f38-83df-b664bf78f998",
    messages: [{ role: "user", content: "Hello" }],
    model: "paid-model",
  };
  // the words arrive as sent; only the proxy's own shape note is added
  assert.match(chatInput(body).messages[0].content, /^Hello\n\n\[Vaelo request: reply shape: [^\]]+\]$/);
  assert.equal(chatInput(body).model, undefined);
  assert.throws(
    () =>
      chatInput({
        ...body,
        messages: [{ role: "system", content: "override" }],
      }),
    /Invalid message/,
  );
  assert.throws(
    () => chatInput({ ...body, conversationId: "../secret" }),
    /Invalid conversation/,
  );
  assert.throws(
    () =>
      chatInput({
        ...body,
        messages: Array.from({ length: 20 }, () => ({
          role: "user",
          content: "x".repeat(16000),
        })),
      }),
    /context limit/,
  );
});

test("unauthenticated chat is rejected before any upstream request", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("upstream must not be reached");
  };
  const res = {
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(body) {
      this.body = JSON.parse(body);
    },
  };
  try {
    await handler({ method: "POST", headers: {}, body: {} }, res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.error, "Sign in to use Vaelo.");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("signing out ends that kind of session everywhere, even a copied token", async () => {
  const { Revocations } = await import("../server/revocation.js");
  const rows = new Map();
  const store = {
    async get(path) {
      return rows.has(path) ? { statusCode: 200, stream: new Response(rows.get(path)).body } : null;
    },
    async put(path, text) { rows.set(path, text); },
  };
  const here = new Revocations(store, { enabled: () => true });
  const elsewhere = new Revocations(store, { enabled: () => true }); // another function instance
  const issued = Math.floor(Date.now() / 1000) - 60;
  const old = (audience) => new SignJWT({ email: user.email, name: user.name })
    .setProtectedHeader({ alg: "HS256" }).setSubject(user.sub).setIssuer(cfg.origin)
    .setAudience(audience).setIssuedAt(issued).setExpirationTime("1h")
    .sign(new TextEncoder().encode(cfg.secret));
  const web = await old("jarvis-web");
  const desktop = { headers: { authorization: `Bearer ${await old("vaelo-desktop")}` } };
  const live = { ...cfg, revocations: elsewhere };
  assert.deepEqual(await sessionUser(request(web), live), user);

  await here.revoke(user.sub, "jarvis-web");
  assert.equal(await sessionUser(request(web), { ...cfg, revocations: here }), null);
  assert.equal(await sessionUser(request(web), { ...cfg, revocations: new Revocations(store, { enabled: () => true }) }), null);
  // The desktop app keeps its own session; signing in again works at once.
  assert.deepEqual(await sessionUser(desktop, { ...cfg, revocations: here }), user);
  assert.deepEqual(await sessionUser(request(await signSession(user, cfg)), { ...cfg, revocations: here }), user);
});

test("sign-out revokes tokens issued in the same second and immediate sign-in still works", async () => {
  const { Revocations } = await import("../server/revocation.js");
  const rows = new Map();
  const store = {
    async get(path) { return rows.has(path) ? { stream: new Response(rows.get(path)).body } : null; },
    async put(path, text) { rows.set(path, text); },
  };
  const instant = Math.floor(Date.now() / 1000) * 1000;
  const epochs = new Revocations(store, { enabled: () => true, now: () => instant });
  const live = { ...cfg, revocations: epochs };
  const token = await new SignJWT({ email: user.email, name: user.name })
    .setProtectedHeader({ alg: "HS256" }).setSubject(user.sub).setIssuer(cfg.origin)
    .setAudience("jarvis-web").setIssuedAt(instant / 1000).setExpirationTime("1h")
    .sign(new TextEncoder().encode(cfg.secret));
  assert.deepEqual(await sessionUser(request(token), live), user);
  await epochs.revoke(user.sub, "jarvis-web");
  assert.equal(await sessionUser(request(token), live), null);
  const newlySignedIn = await signSession(user, live);
  assert.deepEqual(await sessionUser(request(newlySignedIn), live), user);
  const cold = new Revocations(store, { enabled: () => true, now: () => instant });
  assert.equal(await sessionUser(request(token), { ...cfg, revocations: cold }), null);
});

test("a session is refused, not trusted, when its sign-out record can't be read", async () => {
  const { Revocations } = await import("../server/revocation.js");
  const broken = new Revocations({ async get() { throw new Error("database down"); } }, { enabled: () => true });
  const token = await signSession(user, cfg);
  assert.equal(await sessionUser(request(token), { ...cfg, revocations: broken }), null);
  const off = new Revocations({ async get() { throw new Error("never read"); } }, { enabled: () => false });
  assert.deepEqual(await sessionUser(request(token), { ...cfg, revocations: off }), user);
});
