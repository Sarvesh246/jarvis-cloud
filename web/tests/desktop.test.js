import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DesktopAuth } from "../server/desktop-auth.js";
import { signSession, sessionUser, sameOrigin, settings, cookieNames } from "../server/security.js";
import { createDesktopAuthHandler } from "../api/desktop-auth.js";
import { createDesktopFetch, CLOUD_ORIGIN } from "../src/lib/desktop-transport.js";
import { readDesktopHandoff, markDesktopHandoffStarted } from "../src/lib/desktop-handoff.js";
import { pcmWav } from "../src/lib/dictation.js";
import { decodeAudio, transcribe } from "../server/transcription.js";
import transcribeHandler from "../api/transcribe.js";

const cfg = settings({ APP_ORIGIN: "https://vaelo.example", SESSION_SECRET: "s".repeat(64), ALLOWED_EMAIL: "owner@example.com" });
const user = { sub: "owner", email: cfg.email, name: "Owner" };
const proof = "v".repeat(43);
const challenge = createHash("sha256").update(proof).digest("base64url");
function storage() {
  const entries = new Map(); let version = 0;
  return {
    entries,
    async get(path) {
      const entry = entries.get(path);
      return entry ? { stream: new Response(entry.text).body, blob: { etag: entry.etag } } : null;
    },
    async put(path, text, options) {
      const previous = entries.get(path);
      if ((previous && !options.allowOverwrite) || (options.ifMatch && options.ifMatch !== previous?.etag))
        throw new Error("Precondition failed");
      entries.set(path, { text, etag: String(++version) });
    },
    async del(path) { entries.delete(path); },
  };
}
function response() {
  return { headers: {}, setHeader(name, value) { this.headers[name] = value; }, end(value) { this.data = JSON.parse(value); } };
}

test("desktop bearer sessions are audience-bound and cannot bypass browser CSRF before verification", async () => {
  const token = await signSession(user, cfg, "vaelo-desktop");
  const req = { headers: { authorization: `Bearer ${token}`, "content-type": "application/json" } };
  assert.throws(() => sameOrigin(req, cfg), /origin/);
  assert.deepEqual(await sessionUser(req, cfg), user);
  assert.doesNotThrow(() => sameOrigin(req, cfg));
  assert.equal(await sessionUser({ headers: { cookie: `${cookieNames(cfg).session}=${token}` } }, cfg), null);
  const webToken = await signSession(user, cfg);
  assert.equal(await sessionUser({ headers: { authorization: `Bearer ${webToken}` } }, cfg), null);
  req.headers.authorization += "tampered";
  assert.equal(await sessionUser(req, cfg), null);
  assert.throws(() => sameOrigin(req, cfg), /origin/);
});

test("desktop sign-in grants expire, reject a stolen code and admit one exchange across concurrent requests", async () => {
  const store = storage(); let now = 1000;
  const auth = new DesktopAuth(store, () => now);
  const code = await auth.grant(user, challenge);
  await assert.rejects(auth.exchange(code, "x".repeat(43), cfg), /verified/);
  const attempts = await Promise.allSettled([auth.exchange(code, proof, cfg), auth.exchange(code, proof, cfg)]);
  assert.equal(attempts.filter(result => result.status === "fulfilled").length, 1);
  const token = attempts.find(result => result.status === "fulfilled").value;
  assert.deepEqual(await sessionUser({ headers: { authorization: `Bearer ${token}` } }, cfg), user);
  await assert.rejects(auth.exchange(code, proof, cfg), /expired/);
  const expired = await auth.grant(user, challenge);
  now += 60_001;
  await assert.rejects(auth.exchange(expired, proof, cfg), /expired/);
  assert.equal([...store.entries.keys()].some(path => path.includes(expired)), false);
});

test("desktop authorization requires a browser owner session and CSRF; exchange needs no browser cookie", async () => {
  const auth = new DesktopAuth(storage());
  const handler = createDesktopAuthHandler({ configuration: () => cfg, store: auth });
  const token = await signSession(user, cfg);
  const csrf = "a".repeat(64);
  const headers = { origin: cfg.origin, "content-type": "application/json", "x-csrf-token": csrf,
    cookie: `${cookieNames(cfg).session}=${token}; ${cookieNames(cfg).csrf}=${csrf}` };
  for (const invalid of [{}, { ...headers, origin: "https://evil.example" }, { ...headers, "x-csrf-token": "" }]) {
    const res = response();
    await handler({ method: "POST", headers: invalid, body: { action: "authorize", challenge } }, res);
    assert.ok([401, 403].includes(res.statusCode));
  }
  const issued = response();
  await handler({ method: "POST", headers, body: { action: "authorize", challenge } }, issued);
  assert.equal(issued.statusCode, 200);
  const exchanged = response();
  await handler({ method: "POST", headers: {}, body: { action: "exchange", code: issued.data.code, verifier: proof } }, exchanged);
  assert.equal(exchanged.statusCode, 200);
  assert.ok(exchanged.data.token);
});

test("all desktop API paths retain query, body, streaming and cancellation without leaking credentials", async () => {
  const controller = new AbortController(); const calls = []; let cleared = 0;
  const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("data: first\n\n")); c.close(); } });
  const stream = new Response(body, { headers: { "content-type": "text/event-stream" } });
  const transport = createDesktopFetch({
    loadToken: async () => "secret", clearToken: async () => cleared++,
    browserFetch: async (...args) => { calls.push({ browser: args }); return new Response("asset"); },
    nativeFetch: async (url, init) => { calls.push({ url, init }); return url.includes("/chat?") ? stream : new Response("{}", { status: url.endsWith("/stop") ? 401 : 200 }); },
  });
  for (const path of ["session", "status", "chats", "feed", "work", "approval", "transcribe"])
    await transport(`/api/${path}`, { method: "POST", body: '{"value":1}', signal: controller.signal });
  const result = await transport("/api/chat?run=abc&after=2", { signal: controller.signal });
  assert.equal(result, stream);
  assert.equal(await result.text(), "data: first\n\n");
  assert.ok(calls.every(call => call.url.startsWith(`${CLOUD_ORIGIN}/api/`)));
  assert.ok(calls.every(call => call.init.headers.get("authorization") === "Bearer secret"));
  assert.equal(new TextDecoder().decode(calls[0].init.body), '{"value":1}');
  controller.abort();
  assert.ok(calls.every(call => call.init.signal.aborted));
  await transport("https://external.example/file");
  assert.equal(calls.at(-1).browser[1].headers, undefined);
  await transport("/api/stop"); assert.equal(cleared, 1);
  await assert.rejects(transport("/api/../outside"), /Invalid/);
});

test("browser handoff survives Google redirect but refuses expired and arbitrary callback addresses", () => {
  const map = new Map();
  const memory = { getItem: k => map.get(k), setItem: (k, v) => map.set(k, v), removeItem: k => map.delete(k) };
  const url = new URL(`https://vaelo.example/?desktop=1&port=45000&state=${proof}&challenge=${challenge}`);
  assert.equal(readDesktopHandoff(memory, url, 1000).port, 45000);
  assert.equal(readDesktopHandoff(memory, new URL("https://vaelo.example/#id_token=google"), 2000).challenge, challenge);
  assert.equal(readDesktopHandoff(memory, new URL("https://vaelo.example/"), 302000), null);
  url.searchParams.set("port", "443");
  assert.equal(readDesktopHandoff(memory, url), null);
});

test("a handoff sent to Google remembers it across the redirect, and a fresh one does not", () => {
  const map = new Map();
  const memory = { getItem: k => map.get(k), setItem: (k, v) => map.set(k, v), removeItem: k => map.delete(k) };
  const url = new URL(`https://vaelo.example/?desktop=1&port=45000&state=${proof}&challenge=${challenge}`);
  const pending = readDesktopHandoff(memory, url, 1000);
  assert.equal(pending.started, undefined);
  assert.equal(markDesktopHandoffStarted(pending, memory).started, true);
  const back = readDesktopHandoff(memory, new URL("https://vaelo.example/#id_token=google"), 2000);
  assert.equal(back.started, true);
  assert.equal(back.challenge, challenge);
  assert.equal(readDesktopHandoff(memory, url, 3000).started, undefined);
});

test("native transport failures retain offline recovery and standard abort semantics", async () => {
  const transport = createDesktopFetch({ loadToken: async () => "session", clearToken: async () => {},
    nativeFetch: async () => { throw "network unavailable"; }, browserFetch: fetch });
  await assert.rejects(transport("/api/session"), TypeError);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(transport("/api/chat", { signal: controller.signal }), { name: "AbortError" });
});

test("desktop audio encodes bounded mono PCM and speech providers receive audio only server-side", async () => {
  const wav = pcmWav([new Float32Array(48000).fill(0.25)], 48000);
  const bytes = decodeAudio(Buffer.from(wav).toString("base64"));
  assert.equal(bytes.length, 32044);
  assert.equal(bytes.readUInt32LE(24), 16000);
  assert.throws(() => decodeAudio(Buffer.from("not audio").toString("base64")), /Invalid/);
  await assert.rejects(transcribe(bytes, {}), /speech provider/);
  let called = 0;
  assert.equal(await transcribe(bytes, { GROQ_API_KEY: "server-secret" }, async (url, init) => {
    called++; assert.equal(url, "https://api.groq.com/openai/v1/audio/transcriptions");
    assert.equal(init.headers.Authorization, "Bearer server-secret");
    assert.equal(init.body.get("file").size, bytes.length);
    return Response.json({ text: "Words to review." });
  }), "Words to review.");
  assert.equal(called, 1);
  const res = response();
  await transcribeHandler({ method: "POST", headers: {}, body: {} }, res);
  assert.equal(res.statusCode, 401);
});
