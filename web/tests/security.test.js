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

test("chat input rejects model/system overrides, oversized context and invalid conversations", () => {
  const body = {
    conversationId: "c5ec5f03-1fd1-4f38-83df-b664bf78f998",
    messages: [{ role: "user", content: "Hello" }],
    model: "paid-model",
  };
  assert.equal(chatInput(body).messages[0].content, "Hello");
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
        messages: Array.from({ length: 4 }, () => ({
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
