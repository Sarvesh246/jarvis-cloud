import test from 'node:test';
import assert from 'node:assert/strict';
import { DesktopRecognition } from '../src/lib/dictation.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture(t, { permission, resume, request } = {}) {
  const calls = { permission: 0, tracks: 0, close: 0, sources: 0, processors: 0, connects: 0, disconnects: 0, requests: [], events: [] };
  const stream = { getTracks: () => [{ stop() { calls.tracks++; } }] };
  const node = () => ({ connect() { calls.connects++; }, disconnect() { calls.disconnects++; } });
  let processor;
  class Context {
    sampleRate = 48000;
    destination = {};
    resume() { return resume?.promise || Promise.resolve(); }
    close() { calls.close++; return Promise.resolve(); }
    createMediaStreamSource(value) { assert.equal(value, stream); calls.sources++; return node(); }
    createScriptProcessor() { calls.processors++; processor = node(); return processor; }
  }
  const globals = {
    navigator: { mediaDevices: { getUserMedia: () => { calls.permission++; return permission?.promise || Promise.resolve(stream); } } },
    AudioContext: Context,
    fetch: async (url, init) => {
      calls.requests.push({ url, init });
      return request ? request(url, init) : Response.json(url === '/api/session' ? { csrf: 'token' } : { text: 'Hello 世界' });
    },
  };
  for (const [key, value] of Object.entries(globals)) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    t.after(() => original ? Object.defineProperty(globalThis, key, original) : delete globalThis[key]);
  }
  const recognition = new DesktopRecognition();
  recognition.onend = () => calls.events.push('end');
  recognition.onerror = event => calls.events.push(event.error);
  recognition.onprocessing = () => calls.events.push('processing');
  recognition.onresult = event => calls.events.push(event.results[0][0].transcript);
  return { recognition, calls, stream, record(length = 48000) {
    processor.onaudioprocess({ inputBuffer: { length, getChannelData: () => new Float32Array(length).fill(0.25) } });
  }, get processor() { return processor; } };
}

test('cancel during audio resume never reconnects a stopped microphone', async t => {
  const resume = deferred();
  const { recognition, calls } = fixture(t, { resume });
  const started = recognition.start();
  await Promise.resolve();
  recognition.abort();
  resume.resolve();
  await started;
  assert.equal(calls.sources, 0);
  assert.equal(calls.processors, 0);
  assert.equal(calls.tracks, 1);
  assert.equal(calls.close, 1);
  assert.deepEqual(calls.events, ['end']);
  assert.equal(calls.requests.length, 0);
});

test('stop during audio resume ends an empty take exactly once', async t => {
  const resume = deferred();
  const { recognition, calls } = fixture(t, { resume });
  const started = recognition.start();
  await Promise.resolve();
  await recognition.stop();
  resume.resolve();
  await started;
  assert.equal(calls.sources, 0);
  assert.equal(calls.close, 1);
  assert.equal(calls.tracks, 1);
  assert.deepEqual(calls.events, ['processing', 'end']);
  assert.equal(calls.requests.length, 0);
});

test('late microphone permission after cancel releases tracks without a second end', async t => {
  const permission = deferred();
  const { recognition, calls, stream } = fixture(t, { permission });
  const started = recognition.start();
  recognition.abort();
  permission.resolve(stream);
  await started;
  assert.equal(calls.tracks, 1);
  assert.equal(calls.sources, 0);
  assert.deepEqual(calls.events, ['end']);
});

test('cancelled initialization ignores late permission and audio resume failures', async t => {
  for (const phase of ['permission', 'resume']) await t.test(phase, async t => {
    const pending = deferred();
    const { recognition, calls } = fixture(t, { [phase]: pending });
    const started = recognition.start();
    await Promise.resolve();
    recognition.abort();
    pending.reject(Object.assign(new Error('Access denied'), { name: 'NotAllowedError' }));
    await started;
    assert.deepEqual(calls.events, ['end']);
    assert.equal(calls.sources, 0);
  });
});

test('cancel during transcription suppresses late text and repeated completion', async t => {
  const transcript = deferred();
  const { recognition, calls, record } = fixture(t, {
    request: url => url === '/api/session' ? Response.json({ csrf: 'token' }) : transcript.promise,
  });
  await recognition.start();
  record();
  const stopped = recognition.stop();
  for (let i = 0; i < 20 && calls.requests.length < 2; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.requests.length, 2);
  recognition.abort();
  recognition.abort();
  transcript.resolve(Response.json({ text: 'Discarded words' }));
  await stopped;
  assert.deepEqual(calls.events, ['processing', 'end']);
  assert.ok(calls.requests.every(call => call.init.signal.aborted));
  assert.equal(calls.tracks, 1);
  assert.equal(calls.close, 1);
});

test('ordinary capture keeps PCM, CSRF, transcript and one completion after repeated stop', async t => {
  const f = fixture(t);
  await f.recognition.start();
  f.record();
  await f.recognition.stop();
  await f.recognition.stop();
  assert.deepEqual(f.calls.events, ['processing', 'Hello 世界', 'end']);
  assert.equal(f.processor.onaudioprocess, null);
  assert.equal(f.calls.disconnects, 2);
  assert.equal(f.calls.close, 1);
  assert.equal(f.calls.tracks, 1);
  const [{ url }, { init }] = f.calls.requests;
  assert.equal(url, '/api/session');
  assert.equal(init.headers['X-CSRF-Token'], 'token');
  const wav = Buffer.from(JSON.parse(init.body).audio, 'base64');
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.readUInt32LE(24), 16000);
  assert.equal(wav.length, 32044);
});

test('repeated starts cannot open a second stream or restart a finished take', async t => {
  const permission = deferred();
  const { recognition, calls, stream } = fixture(t, { permission });
  const started = recognition.start();
  await recognition.start();
  permission.resolve(stream);
  await started;
  recognition.abort();
  await recognition.start();
  assert.equal(calls.permission, 1);
  assert.equal(calls.sources, 1);
  assert.equal(calls.tracks, 1);
  assert.deepEqual(calls.events, ['end']);
});

test('active initialization failures report once and release acquired audio resources', async t => {
  for (const phase of ['permission', 'resume']) await t.test(phase, async t => {
    const pending = deferred();
    const { recognition, calls } = fixture(t, { [phase]: pending });
    const started = recognition.start();
    await Promise.resolve();
    pending.reject(Object.assign(new Error('Unavailable'), { name: phase === 'permission' ? 'NotAllowedError' : 'NotSupportedError' }));
    await started;
    recognition.abort();
    assert.deepEqual(calls.events, [phase === 'permission' ? 'not-allowed' : 'audio-capture', 'end']);
    assert.equal(calls.tracks, phase === 'permission' ? 0 : 1);
    assert.equal(calls.close, phase === 'permission' ? 0 : 1);
    assert.equal(calls.requests.length, 0);
  });
});

test('automatic recording limit uploads once and releases capture before transcription', async t => {
  const f = fixture(t);
  await f.recognition.start();
  // Only the final audio callback needs samples; the counter represents the
  // preceding minute without allocating a minute of mocked audio.
  f.recognition.samples = 48000 * 60 - 4096;
  f.record(4096);
  assert.equal(f.calls.tracks, 1);
  assert.equal(f.processor.onaudioprocess, null);
  await f.recognition.stop();
  for (let i = 0; i < 20 && !f.calls.events.includes('end'); i++) await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.calls.events, ['processing', 'Hello 世界', 'end']);
  assert.equal(f.calls.requests.length, 2);
  assert.equal(f.calls.close, 1);
});

test('failed transcription reports the established error and ends without leaked capture', async t => {
  const f = fixture(t, { request: url => Response.json(url === '/api/session' ? { csrf: 'token' } : { error: 'Try again.' }, { status: url === '/api/session' ? 200 : 503 }) });
  await f.recognition.start();
  f.record();
  await f.recognition.stop();
  assert.deepEqual(f.calls.events, ['processing', 'transcription', 'end']);
  assert.equal(f.calls.tracks, 1);
  assert.equal(f.calls.close, 1);
  assert.equal(f.recognition.chunks.length, 0);
});
