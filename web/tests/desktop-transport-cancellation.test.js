import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createDesktopFetch, CLOUD_ORIGIN } from '../src/lib/desktop-transport.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture(overrides = {}) {
  const calls = [];
  const transport = createDesktopFetch({
    loadToken: async () => 'secret', clearToken: async () => {},
    browserFetch: async (...args) => { calls.push({ browser: args }); return new Response('asset'); },
    nativeFetch: async (url, init) => { calls.push({ url, init }); return new Response('ok'); },
    ...overrides,
  });
  return { transport, calls };
}
const outcome = promise => promise.then(() => 'fulfilled', error => error.name);
const promptly = promise => Promise.race([promise, delay(100).then(() => 'pending')]);

test('already cancelled desktop requests never read credentials or enter native HTTP', async () => {
  let loads = 0;
  const { transport, calls } = fixture({ loadToken: async () => { loads++; return 'secret'; } });
  const controller = new AbortController(); controller.abort();
  assert.equal(await outcome(transport('/api/chat', { signal: controller.signal })), 'AbortError');
  assert.equal(loads, 0);
  assert.equal(calls.length, 0);
});

for (const late of ['resolve', 'reject']) test(`cancellation settles during credential lookup despite late ${late}`, async () => {
  const token = deferred(), entered = deferred();
  const { transport, calls } = fixture({ loadToken: () => { entered.resolve(); return token.promise; } });
  const controller = new AbortController();
  const result = outcome(transport('/api/chat', { signal: controller.signal }));
  await entered.promise; controller.abort();
  const status = await promptly(result);
  token[late](late === 'resolve' ? 'obsolete' : new Error('credential failure'));
  await result;
  await delay(0);
  assert.equal(status, 'AbortError');
  assert.equal(calls.length, 0);
});

test('cancellation settles while serializing a pending request body', async () => {
  let bodyController;
  const body = new ReadableStream({ start(controller) { bodyController = controller; } });
  const { transport, calls } = fixture();
  const controller = new AbortController();
  const result = outcome(transport('/api/chat', { method: 'POST', body, duplex: 'half', signal: controller.signal }));
  await delay(0); controller.abort();
  const status = await promptly(result);
  bodyController.enqueue(new TextEncoder().encode('obsolete')); bodyController.close();
  await result;
  assert.equal(status, 'AbortError');
  assert.equal(calls.length, 0);
});

test('late body read failures after cancellation are observed without starting native HTTP', async () => {
  let bodyController;
  const body = new ReadableStream({ start(controller) { bodyController = controller; } });
  const { transport, calls } = fixture();
  const controller = new AbortController();
  const result = outcome(transport('/api/transcribe', { method: 'POST', body, duplex: 'half', signal: controller.signal }));
  await delay(0); controller.abort();
  assert.equal(await promptly(result), 'AbortError');
  bodyController.error(new Error('input disconnected'));
  await delay(0);
  assert.equal(calls.length, 0);
});

test('cancelling one credential waiter leaves an independent request and 401 handling intact', async () => {
  const token = deferred(); let cleared = 0;
  const response = new Response('unauthorized', { status: 401 });
  const { transport, calls } = fixture({
    loadToken: () => token.promise,
    clearToken: async expired => { assert.equal(expired, 'secret'); cleared++; },
    nativeFetch: async (url, init) => { calls.push({ url, init }); return response; },
  });
  const controller = new AbortController();
  const cancelled = outcome(transport('/api/chat', { signal: controller.signal }));
  const active = transport('/api/session');
  controller.abort();
  assert.equal(await promptly(cancelled), 'AbortError');
  token.resolve('secret');
  assert.equal(await active, response);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${CLOUD_ORIGIN}/api/session`);
  assert.equal(cleared, 1);
});

test('completed preparation removes abort listeners and retains exact bytes and response identity', async () => {
  const response = new Response('data: words\n\n', { headers: { 'content-type': 'text/event-stream' } });
  const controller = new AbortController();
  const { transport } = fixture({ nativeFetch: async (url, init) => {
    assert.equal(url, `${CLOUD_ORIGIN}/api/chat?run=abc&after=2`);
    assert.equal(getEventListeners(init.signal, 'abort').length, 0);
    assert.equal(init.headers.get('authorization'), 'Bearer secret');
    assert.equal(new TextDecoder().decode(init.body), '日本語 👋\n$E=mc^2$');
    assert.equal(init.maxRedirections, 0);
    assert.equal(init.connectTimeout, 30_000);
    return response;
  } });
  assert.equal(await transport('/api/chat?run=abc&after=2', {
    method: 'POST', body: '日本語 👋\n$E=mc^2$', signal: controller.signal,
  }), response);
  assert.equal(await response.text(), 'data: words\n\n');
});

test('credential errors remain visible and external fetches bypass credential preparation', async () => {
  const error = new Error('credential store unavailable');
  const { transport, calls } = fixture({ loadToken: async () => { throw error; } });
  await assert.rejects(transport('/api/session'), value => value === error);
  assert.equal(await (await transport('https://example.test/image')).text(), 'asset');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].browser[0], 'https://example.test/image');
});

test('native failures and cancellation preserve the established error contract', async () => {
  const controller = new AbortController();
  const { transport } = fixture({ nativeFetch: async () => { controller.abort(); throw new Error('cancelled IPC'); } });
  assert.equal(await outcome(transport('/api/chat', { signal: controller.signal })), 'AbortError');
  const offline = fixture({ nativeFetch: async () => { throw new Error('IPC unavailable'); } });
  await assert.rejects(offline.transport('/api/session'), { name: 'TypeError', message: 'Could not reach Vaelo. Check your internet connection.' });
});
