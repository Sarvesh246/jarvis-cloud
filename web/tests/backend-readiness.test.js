import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from 'node:http';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { forgetHealthy, noteHealthy, probeBackend, waitForBackend, wakeBackend, probeCapabilities } from "../server/backend-readiness.js";

test('explicit release diagnostics expose only validated backend revision and protocol',async()=> {
  const result=await probeCapabilities('https://backend.example/','private-key',{request:async(url,options)=> {
    assert.equal(url,'https://backend.example/vaelo/capabilities');
    assert.equal(options.headers.Authorization,'Bearer private-key');
    return Response.json({revision:'a'.repeat(40),protocol:3,secret:'private-key',tools:['private arbitrary data']});
  }});
  assert.deepEqual(result,{backend_revision:'a'.repeat(40),backend_protocol:3});
  for(const body of [JSON.stringify({revision:'private data'}),'[]','x'.repeat(17000),'{'])
    assert.equal(await probeCapabilities('https://backend.example','key',{request:async()=>new Response(body)}),null);
});

test("cold-start edge failures wake the service once and only use GET requests", async () => {
  const calls = [];
  let probes = 0;
  await waitForBackend("https://backend.example/", {
    pause: async () => {},
    request: async (url, options) => {
      calls.push({ url, method: options.method || "GET" });
      if (url.endsWith("/health")) {
        probes++;
        return probes < 3 ? new Response("Render unavailable", { status: 502 }) : Response.json({ status: "ok" });
      }
      return new Response("Application loading");
    },
  });
  assert.equal(probes, 3);
  assert.equal(calls.filter(c => c.url === "https://backend.example/").length, 1);
  assert.ok(calls.every(c => c.method === "GET"));
});

test("a stopped request cancels warm-up before any further probe", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(waitForBackend("https://backend.example", {
    signal: controller.signal,
    request: async () => assert.fail("aborted warm-up must not make a request"),
  }), { name: "AbortError" });
});

test("an unavailable service has a bounded wait", async () => {
  await assert.rejects(waitForBackend("https://backend.example", {
    maxWaitMs: 0,
    request: async () => assert.fail("expired deadline must not make a request"),
  }), /still starting/);
});

test("cold-start error response bodies are cancelled before probing again", async () => {
  let cancelled = 0;
  let probes = 0;
  await waitForBackend("https://cleanup.example", {
    pause: async () => {},
    request: async (url) => {
      if (!url.endsWith("/health")) return new Response("Loading");
      if (++probes === 3) return Response.json({ status: "ok" });
      return new Response(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode("Edge error")); },
        cancel() { cancelled++; },
      }), { status: 502 });
    },
  });
  assert.equal(cancelled, 2);
});

const HEALTH_LIMIT = 16 * 1024;
const encoder = new TextEncoder();
function healthBody(size) {
  const prefix = '{"status":"ok","detail":"';
  return encoder.encode(prefix + ' '.repeat(size - prefix.length - 2) + '"}');
}

function trackedResponse(chunks, { fail = false, cancelFails = false, afterRead } = {}) {
  let reads = 0, cancels = 0, releases = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (reads < chunks.length) controller.enqueue(chunks[reads++]);
      else if (fail) controller.error(new Error('connection interrupted'));
      else controller.close();
    },
    cancel() { cancels++; if (cancelFails) throw new Error('cleanup failed'); },
  }, { highWaterMark: 0 });
  const getReader = body.getReader.bind(body);
  body.getReader = (...args) => {
    const reader = getReader(...args);
    const release = reader.releaseLock.bind(reader);
    reader.releaseLock = () => { releases++; release(); };
    const read = reader.read.bind(reader);
    reader.read = async () => { const result = await read(); afterRead?.(result); return result; };
    return reader;
  };
  return { response: new Response(body), body, stats: () => ({ reads, cancels, releases }) };
}

test('health probes accept the byte limit and reject oversized valid JSON', async () => {
  for (const [size, expected] of [[HEALTH_LIMIT, true], [HEALTH_LIMIT + 1, false]]) {
    const sample = trackedResponse([healthBody(size)]);
    assert.equal(await probeBackend('https://size.example', { request: async () => sample.response }), expected);
    assert.equal(sample.body.locked, false);
    assert.equal(sample.stats().releases, 1);
  }
});

test('oversized health streams stop reading and cancel before the remaining body', async () => {
  const sample = trackedResponse([new Uint8Array(HEALTH_LIMIT), new Uint8Array(1), encoder.encode('unread')]);
  assert.equal(await probeBackend('https://stream-size.example', { request: async () => sample.response }), false);
  assert.deepEqual(sample.stats(), { reads: 2, cancels: 1, releases: 1 });
  assert.equal(sample.body.locked, false);
});

test('health JSON rejects damaged UTF-8 but accepts split Unicode and a BOM', async () => {
  const damaged = Buffer.concat([Buffer.from('{"status":"ok","detail":"'), Buffer.from([0xc3, 0x28]), Buffer.from('"}')]);
  assert.equal(await probeBackend('https://unicode.example', { request: async () => new Response(damaged) }), false);
  const valid = encoder.encode('\uFEFF{"status":"ok","detail":"東京 🌤"}');
  const sample = trackedResponse(Array.from(valid, byte => Uint8Array.of(byte)));
  assert.equal(await probeBackend('https://unicode.example', { request: async () => sample.response }), true);
  assert.equal(sample.body.locked, false);
});

test('failed health reads release their reader and a later probe still succeeds', async () => {
  const sample = trackedResponse([encoder.encode('{"status":')], { fail: true });
  assert.equal(await probeBackend('https://broken.example', { request: async () => sample.response }), false);
  assert.equal(sample.body.locked, false);
  assert.equal(await probeBackend('https://broken.example', { request: async () => Response.json({ status: 'ok' }) }), true);
});

test('warm-up rejects oversized health replies, wakes once and recovers without POST', async () => {
  const calls = [];
  const sample = trackedResponse([healthBody(HEALTH_LIMIT + 1), encoder.encode('unread')]);
  let probes = 0;
  await waitForBackend('https://retry.example', {
    pause: async () => {},
    request: async (url, options) => {
      calls.push([url, options.method || 'GET']);
      if (url.endsWith('/health')) return ++probes === 1 ? sample.response : Response.json({ status: 'ok' });
      return new Response('Waking');
    },
  });
  assert.equal(probes, 2);
  assert.equal(calls.filter(([url]) => url.endsWith('/')).length, 1);
  assert.ok(calls.every(([, method]) => method === 'GET'));
  assert.equal(sample.body.locked, false);
  assert.equal(sample.stats().cancels, 1);
});

test('cancellation during health reading cannot mark the backend healthy', async () => {
  const controller = new AbortController();
  const sample = trackedResponse([encoder.encode('{"status":"ok"}')], {
    afterRead: () => controller.abort(),
  });
  let calls = 0;
  const request = async () => ++calls === 1 ? sample.response : Response.json({ status: 'ok' });
  await assert.rejects(waitForBackend('https://abort.example', { signal: controller.signal, request }), { name: 'AbortError' });
  assert.equal(sample.body.locked, false);
  await waitForBackend('https://abort.example', { request });
  assert.equal(calls, 2, 'a cancelled read must not populate the healthy cache');
});

test('pre-aborted probes and wake requests never contact the backend', async () => {
  const controller = new AbortController(); controller.abort();
  for (const operation of [probeBackend, wakeBackend]) {
    let calls = 0;
    await assert.rejects(operation('https://preabort.example', {
      signal: controller.signal,
      request: async () => { calls++; return Response.json({ status: 'ok' }); },
    }), { name: 'AbortError' });
    assert.equal(calls, 0);
  }
});

test('healthy cache is scoped to backend and transport and expires after clock rollback', async () => {
  const originalNow = Date.now;
  let now = 100000, calls = 0;
  Date.now = () => now;
  try {
    const request = async () => { calls++; return Response.json({ status: 'ok' }); };
    noteHealthy('https://cache.example/', request);
    await waitForBackend('https://cache.example', { request });
    assert.equal(calls, 0);
    now--;
    await waitForBackend('https://cache.example', { request });
    assert.equal(calls, 1, 'a future cache timestamp cannot establish recent health');
    now += 150000;
    await waitForBackend('https://cache.example', { request });
    assert.equal(calls, 2);
    forgetHealthy('https://cache.example/', request);
    await waitForBackend('https://cache.example', { request });
    assert.equal(calls, 3);
    await waitForBackend('https://other.example', { request });
    assert.equal(calls, 4);
    let otherCalls = 0;
    await waitForBackend('https://cache.example', { request: async () => { otherCalls++; return Response.json({ status: 'ok' }); } });
    assert.equal(otherCalls, 1);
  } finally { Date.now = originalNow; }
});

test('health checks contain malformed shapes, empty bodies and cleanup failures', async () => {
  for (const content of ['null', '[]', 'true', '"ok"', '{"status":true}', '{"status":"starting"}', 'not JSON', '']) {
    assert.equal(await probeBackend('https://shape.example', { request: async () => new Response(content) }), false);
  }
  assert.equal(await probeBackend('https://shape.example', { request: async () => new Response(null, { status: 204 }) }), false);
  const sample = trackedResponse([healthBody(HEALTH_LIMIT + 1)], { cancelFails: true });
  assert.equal(await probeBackend('https://cleanup-error.example', { request: async () => sample.response }), false);
  assert.deepEqual(sample.stats(), { reads: 1, cancels: 1, releases: 1 });
  assert.equal(sample.body.locked, false);
  assert.equal(await probeBackend('https://shape.example', { request: async () => Response.json({ status: 'ok' }) }), true);
});

test('health byte limits count Unicode bytes rather than characters or advertised length', async () => {
  const text = JSON.stringify({ status: 'ok', detail: '🌤'.repeat(5000) });
  assert.ok(text.length < HEALTH_LIMIT);
  assert.ok(encoder.encode(text).byteLength > HEALTH_LIMIT);
  for (const length of ['1', String(HEALTH_LIMIT * 100)]) {
    assert.equal(await probeBackend('https://byte-limit.example', {
      request: async () => new Response(text, { headers: { 'Content-Length': length } }),
    }), false);
    assert.equal(await probeBackend('https://byte-limit.example', {
      request: async () => new Response('{"status":"ok"}', { headers: { 'Content-Length': length } }),
    }), true, 'the received body, not an untrusted length header, determines health');
  }
});

async function localBackend(t, listener) {
  const server = createServer(listener);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  return `http://127.0.0.1:${server.address().port}`;
}

test('real HTTP warm-up cancels an open oversized body and recovers with one wake', { timeout: 10000 }, async t => {
  const calls = [];
  let probes = 0, oversizedClosed;
  const base = await localBackend(t, (req, res) => {
    calls.push([req.method, req.url]);
    if (req.url === '/health' && ++probes === 1) {
      oversizedClosed = once(res, 'close');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.write(healthBody(HEALTH_LIMIT + 1));
      // Intentionally leave this response open: rejection must cancel it.
    } else if (req.url === '/health') res.end('{"status":"ok"}');
    else res.end('Waking');
  });
  await waitForBackend(base, { pause: async () => {} });
  await oversizedClosed;
  assert.deepEqual(calls, [['GET', '/health'], ['GET', '/'], ['GET', '/health']]);
  await waitForBackend(base);
  assert.equal(calls.length, 3, 'successful recovery retains the established warm cache');
  forgetHealthy(base);
});

test('real HTTP health body timeouts and caller cancellation release connections', { timeout: 10000 }, async t => {
  let responseClosed;
  const controller = new AbortController();
  let cancelCaller = false;
  const base = await localBackend(t, (req, res) => {
    responseClosed = once(res, 'close');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write('{"status":');
    if (cancelCaller) controller.abort();
  });
  assert.equal(await probeBackend(base, { timeoutMs: 1000 }), false);
  assert.ok(responseClosed, 'the timed-out probe reached the local HTTP server');
  await responseClosed;
  cancelCaller = true;
  await assert.rejects(waitForBackend(base, { signal: controller.signal }), { name: 'AbortError' });
  await responseClosed;
});

test('a clock rollback during warm-up cannot extend its overall deadline', async () => {
  const originalNow = Date.now;
  let now = originalNow(), pauses = 0, wakes = 0;
  Date.now = () => now;
  try {
    await assert.rejects(waitForBackend('https://deadline.example', {
      maxWaitMs: 100,
      request: async url => {
        if (url.endsWith('/health')) { now -= 60000; return new Response('Starting', { status: 502 }); }
        wakes++;
        return new Response('Waking');
      },
      pause: async () => {
        if (++pauses > 1) throw new Error('wall-clock rollback extended the wait');
        await delay(150);
      },
    }), /cloud server is still starting/);
    assert.equal(wakes, 1);
    assert.equal(pauses, 1);
  } finally { Date.now = originalNow; }
});

test('a warm-up started early reports waking to a listener that joins late', async () => {
  const { warmBackend } = await import('../server/backend-readiness.js');
  let probes = 0;
  const request = async url => {
    if (String(url).endsWith('/health') && ++probes > 1) return Response.json({ status: 'ok' });
    return new Response('loading', { status: 502 });
  };
  const warm = warmBackend('https://warm-late.example', { request, pause: async () => {} });
  await warm.promise;
  assert.equal(warm.state.woke, true);
  warm.abort();
});
