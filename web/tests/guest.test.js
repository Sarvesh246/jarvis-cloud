import test from "node:test";
import assert from "node:assert/strict";
import {
  settings,
  signGuest,
  signSession,
  sessionUser,
  guestUser,
  authorize,
  authorizeAny,
  cookieNames,
} from "../server/security.js";
import { chatInput, guestInput, streamChat } from "../server/chat.js";

const cfg = settings({
  APP_ORIGIN: "https://vaelo.example",
  GOOGLE_CLIENT_ID: "test.apps.googleusercontent.com",
  ALLOWED_EMAIL: "owner@gmail.com",
  SESSION_SECRET: "x".repeat(64),
  JARVIS_API_URL: "https://relay.example",
  JARVIS_API_KEY: "k".repeat(40),
});
const names = cookieNames(cfg);
const withCookie = (name, value) => ({ headers: { cookie: `${name}=${value}` } });
const conversationId = "123e4567-e89b-12d3-a456-426614174000";
const body = (messages) => ({ conversationId, messages });

test("a guest cookie makes a guest and never the owner", async () => {
  const token = await signGuest(cfg);
  const req = withCookie(names.guest, token);
  const guest = await guestUser(req, cfg);
  assert.match(guest.sub, /^guest:[a-f0-9-]{36}$/);
  assert.equal(guest.guest, true);
  assert.equal(await sessionUser(req, cfg), null);
  assert.equal(await sessionUser(withCookie(names.session, token), cfg), null);
  await assert.rejects(authorize(req, cfg), /Sign in/);
  assert.equal((await authorizeAny(req, cfg)).guest, true);
});

test("an owner session is not a guest and a tampered guest cookie is refused", async () => {
  const owner = await signSession({ sub: "g1", email: "owner@gmail.com", name: "Owner" }, cfg);
  assert.equal(await guestUser(withCookie(names.guest, owner), cfg), null);
  const guest = await signGuest(cfg);
  assert.equal(await guestUser(withCookie(names.guest, guest + "x"), cfg), null);
  await assert.rejects(authorizeAny({ headers: {} }, cfg), /Sign in/);
});

test("guest input is text only, without saved work or research, and a short history", () => {
  const long = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `m${i}` }));
  long.push({ role: "user", content: "last" });
  const input = guestInput({ ...chatInput({ ...body(long), research: true, work: { id: "w", revision: "r" } }) });
  assert.equal(input.work, undefined);
  assert.equal(input.research, false);
  assert.ok(input.messages.length <= 16);
  assert.equal(input.messages.at(-1).role, "user");
  const image = chatInput(body([{ role: "user", content: [
    { type: "text", text: "see" },
    { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
  ] }]));
  assert.throws(() => guestInput(image), /text only/);
});

test("a guest's reply is started on the relay with a toolless prompt under a guest key", async () => {
  const user = await guestUser(withCookie(names.guest, await signGuest(cfg)), cfg);
  const input = guestInput(chatInput(body([{ role: "user", content: "hello" }])));
  const posts = [];
  const request = async (url, options = {}) => {
    if (options.method === "POST") {
      posts.push({ url, options });
      return new Response("{}", { status: 202 });
    }
    if (String(url).includes("/events")) return new Response(": end\n\n", { status: 200 });
    return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
  };
  const res = {
    write: () => true, setHeader() {}, flushHeaders() {}, end() {}, on() {}, off() {}, once() {},
  };
  await streamChat({ on() {}, off() {} }, res, cfg, user, input, request, { followMs: 2000 });
  const run = posts.find((post) => post.url.endsWith("/vaelo/runs"));
  assert.ok(run, "the relay was asked to start a run");
  assert.equal(run.options.headers["X-Hermes-Session-Key"], `web:${user.sub}`);
  const system = JSON.parse(run.options.body).messages[0].content;
  assert.match(system, /guest/i);
  assert.doesNotMatch(system, /terminal|workspace|saved work record/i);
});
