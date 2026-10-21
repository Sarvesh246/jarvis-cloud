import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
const origin = "https://vaelo.example";
const shell = "vaelo-shell-v6";
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

function worker({ network = async () => new Response("network", { headers: { "Content-Type": "text/html; charset=utf-8" } }), storage = {} } = {}) {
  const handlers = {}, entries = new Map(), deleted = [], fetched = [], writes = [];
  const key = request => new URL(typeof request === "string" ? request : request.url, origin).href;
  const cache = {
    async match(request) { return entries.get(key(request))?.clone(); },
    async put(request, response) {
      entries.set(key(request), response.clone());
      writes.push(key(request));
    },
    async addAll(paths) {
      for (const path of paths) await cache.put(path, await network({ url: key(path) }));
    },
    ...storage.cache,
  };
  const caches = {
    async open(name) { assert.equal(name, shell); return cache; },
    async match(request) { return cache.match(request); },
    async keys() { return [shell, "vaelo-shell-v5", "another-app-cache"]; },
    async delete(name) { deleted.push(name); return true; },
    ...storage,
  };
  delete caches.cache;
  let skipped = 0, claimed = 0;
  runInNewContext(source, {
    self: {
      addEventListener(type, handler) { handlers[type] = handler; },
      async skipWaiting() { skipped++; },
      clients: { async claim() { claimed++; } },
    },
    location: { origin }, URL, caches,
    fetch(request) { fetched.push(request.url); return network(request); },
  });
  function dispatch(type, request) {
    const pending = [];
    let response;
    handlers[type]({ request,
      waitUntil(promise) { pending.push(promise); },
      respondWith(promise) { response = Promise.resolve(promise); },
    });
    return { get response() { return response; }, pending,
      async finish() {
        if (response) await response;
        // Includes work registered while respondWith was pending.
        await Promise.all(pending);
      },
    };
  }
  const request = (path, options = {}) => ({ url: new URL(path, origin).href, method: "GET", mode: "cors", ...options });
  return { cache, entries, deleted, fetched, writes, dispatch, request,
    get skipped() { return skipped; }, get claimed() { return claimed; },
  };
}

test("worker keeps successful shell, preferences and asset writes alive through event completion", async () => {
  for (const [path, mode] of [["/", "navigate"], ["/prefs.js", "cors"], ["/assets/app-123.js", "cors"]]) {
    const gate = deferred();
    let written = false;
    const w = worker({ storage: { cache: { async put() { await gate.promise; written = true; } } } });
    const event = w.dispatch("fetch", w.request(path, { mode }));
    assert.equal(await (await event.response).text(), "network");
    assert.ok(event.pending.length > 0, `${path} must extend the fetch event for its cache write`);
    assert.equal(written, false, "the network response does not wait for storage");
    gate.resolve();
    await event.finish();
    assert.equal(written, true);
  }
});

test("asset lookup failure still serves the successful network response", async () => {
  for (const storage of [
    { async open() { throw new Error("storage disabled"); }, async match() { throw new Error("storage disabled"); } },
    { cache: { async match() { throw new Error("cache read failed"); } } },
  ]) {
    const w = worker({ storage });
    const event = w.dispatch("fetch", w.request("/assets/app-123.js"));
    assert.equal(await (await event.response).text(), "network");
    await event.finish();
    assert.equal(w.fetched.length, 1);
  }
});

test("runtime cache write failures are contained without losing online responses", async () => {
  for (const [path, mode] of [["/", "navigate"], ["/prefs.js", "cors"], ["/assets/app-123.js", "cors"]]) {
    const w = worker({ storage: { cache: { async put() { throw new Error("quota exceeded"); } } } });
    const event = w.dispatch("fetch", w.request(path, { mode }));
    assert.equal(await (await event.response).text(), "network");
    assert.ok(event.pending.length > 0);
    await event.finish();
  }
});

test("activation retires only Vaelo shell caches and then claims clients", async () => {
  const w = worker();
  await w.dispatch("activate").finish();
  assert.deepEqual(w.deleted, ["vaelo-shell-v5"]);
  assert.equal(w.claimed, 1);
});

test("cache cleanup failures do not prevent the activated worker from claiming clients", async () => {
  for (const storage of [
    { async keys() { throw new Error("storage unavailable"); } },
    { async delete() { throw new Error("cache cleanup failed"); } },
  ]) {
    const w = worker({ storage });
    await w.dispatch("activate").finish();
    assert.equal(w.claimed, 1);
  }
});

test("offline fallback reads the current shell instead of another cache's stale page", async () => {
  const w = worker({ network: async () => { throw new TypeError("offline"); }, storage: {
    async match() { return new Response("unrelated old response"); },
  } });
  await w.cache.put("/", new Response("current shell"));
  await w.cache.put("/prefs.js", new Response("current preferences"));
  for (const [path, mode, expected] of [["/", "navigate", "current shell"], ["/prefs.js", "cors", "current preferences"]]) {
    const event = w.dispatch("fetch", w.request(path, { mode }));
    assert.equal(await (await event.response).text(), expected);
    await event.finish();
  }
});

test("ordinary online, cached and offline fetches preserve shell and hashed asset contents", async () => {
  let online = true;
  const w = worker({ network: async request => {
    if (!online) throw new TypeError("offline");
    return new Response(`public ${new URL(request.url).pathname} 🌦️`, { headers: { "Content-Type": "text/html" } });
  } });
  const paths = [["/", "navigate"], ["/prefs.js", "cors"], ["/assets/app-123.js", "cors"]];
  for (const [path, mode] of paths) {
    const event = w.dispatch("fetch", w.request(path, { mode }));
    assert.equal(await (await event.response).text(), `public ${path} 🌦️`);
    await event.finish();
  }
  online = false;
  for (const [path, mode] of paths) {
    const event = w.dispatch("fetch", w.request(path, { mode }));
    assert.equal(await (await event.response).text(), `public ${path} 🌦️`);
    await event.finish();
  }
  assert.equal(w.fetched.length, 5, "cached assets never need another network request");
});

test("API, external, non-GET and unhandled static requests bypass shell caching", () => {
  const w = worker();
  for (const request of [
    w.request("/api/chats"), w.request("/api/session", { mode: "navigate" }),
    w.request("https://provider.example/assets/a.js"), w.request("/", { method: "POST" }),
    w.request("/icons/vaelo.png"), w.request("/manifest.webmanifest"),
  ]) {
    const event = w.dispatch("fetch", request);
    assert.equal(event.response, undefined);
    assert.equal(event.pending.length, 0);
  }
  assert.equal(w.fetched.length, 0);
  assert.equal(w.writes.length, 0);
});

test("failed HTTP responses are returned without replacing saved shell data", async () => {
  const w = worker({ network: async () => new Response("unavailable", { status: 503 }) });
  await w.cache.put("/", new Response("saved page"));
  await w.cache.put("/prefs.js", new Response("saved preferences"));
  for (const [path, mode] of [["/", "navigate"], ["/prefs.js", "cors"], ["/assets/missing.js", "cors"]]) {
    const event = w.dispatch("fetch", w.request(path, { mode }));
    assert.equal((await event.response).status, 503);
    await event.finish();
  }
  assert.equal(await (await w.cache.match("/")).text(), "saved page");
  assert.equal(await (await w.cache.match("/prefs.js")).text(), "saved preferences");
  assert.equal(await w.cache.match("/assets/missing.js"), undefined);
});

test("navigating to other files or receiving a non-page response cannot overwrite the offline home page", async () => {
  for (const [path, contentType, redirected] of [
    ["/prefs.js", "application/javascript", false],
    ["/assets/app-123.js", "application/javascript", false],
    ["/other-page", "text/html", false],
    ["/", "application/json", false],
    ["/", "text/html", true],
  ]) {
    const w = worker({ network: async () => {
      const response = new Response("not the shell", { headers: { "Content-Type": contentType } });
      Object.defineProperty(response, "redirected", { value: redirected });
      return response;
    } });
    await w.cache.put("/", new Response("saved home page"));
    const event = w.dispatch("fetch", w.request(path, { mode: "navigate" }));
    assert.equal(await (await event.response).text(), "not the shell");
    await event.finish();
    assert.equal(await (await w.cache.match("/")).text(), "saved home page", path);
  }
});

test("root shortcuts refresh the saved home page and offline navigation retains its fallback", async () => {
  let online = true;
  const w = worker({ network: async () => {
    if (!online) throw new TypeError("offline");
    return new Response("new home page", { headers: { "Content-Type": "Text/HTML; charset=utf-8" } });
  } });
  const event = w.dispatch("fetch", w.request("/?new=1", { mode: "navigate" }));
  await event.finish();
  online = false;
  const offline = w.dispatch("fetch", w.request("/?new=1", { mode: "navigate" }));
  assert.equal(await (await offline.response).text(), "new home page");
  await offline.finish();
});

test("installation waits for both public shell files before activating", async () => {
  const w = worker();
  await w.dispatch("install").finish();
  assert.equal(w.skipped, 1);
  assert.deepEqual(w.writes, [`${origin}/`, `${origin}/prefs.js`]);
});

test("incomplete precaching does not force activation over an existing offline shell", async () => {
  const w = worker({ network: async () => { throw new TypeError("offline"); } });
  await assert.rejects(w.dispatch("install").finish(), /offline/);
  assert.equal(w.skipped, 0);
});
