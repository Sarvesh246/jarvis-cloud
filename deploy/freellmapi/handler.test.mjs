import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from './api/index.mjs';

function response() {
  return { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(body = '') { this.body = body; } };
}

test('image route authenticates before initialization and forwards authorized requests', async () => {
  const previous = process.env.FREELLMAPI_API_KEY;
  process.env.FREELLMAPI_API_KEY = 'test-cloud-key';
  try {
    let initialized = 0;
    const received = [];
    const handler = createHandler(async () => {
      initialized++;
      return { models: 1, app(req, res) { received.push(req); res.end(JSON.stringify({ data: [{ b64_json: 'image' }] })); } };
    });
    for (const authorization of [undefined, 'Bearer wrong']) {
      const res = response();
      await handler({ url: '/v1/images/generations', headers: { authorization } }, res);
      assert.equal(res.statusCode, 401);
      assert.equal(initialized, 0);
    }
    for (const url of ['/v1/images/generations', '/v1/chat/completions', '/v1/models']) {
      const req = { url, method: 'POST', headers: { authorization: 'Bearer test-cloud-key' }, body: { prompt: 'A car', n: 1, size: '1024x768' } };
      const res = response();
      await handler(req, res);
      assert.equal(res.statusCode, 200);
      assert.equal(received.at(-1), req);
      assert.equal(res.headers['Cache-Control'], 'no-store');
    }
    assert.equal(initialized, 1);
    for (const url of ['/api/keys', '/api/settings', '/v1/videos/generations', '/v1/images/edits']) {
      const res = response();
      await handler({ url, headers: { authorization: 'Bearer test-cloud-key' } }, res);
      assert.equal(res.statusCode, 404);
    }
    assert.equal(received.length, 3);
  } finally {
    if (previous === undefined) delete process.env.FREELLMAPI_API_KEY;
    else process.env.FREELLMAPI_API_KEY = previous;
  }
});

test('failed initialization can recover on the next image request', async () => {
  const previous = process.env.FREELLMAPI_API_KEY;
  process.env.FREELLMAPI_API_KEY = 'test-cloud-key';
  try {
    let attempts = 0;
    const handler = createHandler(async () => {
      if (++attempts === 1) throw new Error('temporary failure');
      return { app(req, res) { res.end('ok'); } };
    });
    const req = { url: '/v1/images/generations', headers: { authorization: 'Bearer test-cloud-key' } };
    const first = response();
    await handler(req, first);
    assert.equal(first.statusCode, 503);
    const second = response();
    await handler(req, second);
    assert.equal(second.statusCode, 200);
    assert.equal(second.body, 'ok');
    assert.equal(attempts, 2);
  } finally {
    if (previous === undefined) delete process.env.FREELLMAPI_API_KEY;
    else process.env.FREELLMAPI_API_KEY = previous;
  }
});
