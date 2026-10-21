import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeAudio, transcribe } from '../server/transcription.js';
import { pcmWav } from '../src/lib/dictation.js';
import handler from '../api/transcribe.js';
import { settings, signSession } from '../server/security.js';
import { devices } from '../server/devices.js';
import { revocations } from '../server/revocation.js';

const audio = () => Buffer.from(pcmWav([new Float32Array(160).fill(0.25)], 16000));
const groq = { GROQ_API_KEY: 'offline-groq' };
const both = { ...groq, GEMINI_API_KEY: 'offline-gemini' };
const gemini = { GEMINI_API_KEY: 'offline-gemini' };
const transcript = text => ({ candidates: [{ content: { parts: [{ text }] } }] });
const unavailable = error => error.status === 503 && /Try again/.test(error.message);

test('dictation accepts actual PCM at supported capture rates and rejects inconsistent WAV fields', () => {
  for (const rate of [16000, 44100, 48000]) {
    const bytes = Buffer.from(pcmWav([new Float32Array(rate).fill(-0.25)], rate));
    assert.deepEqual(decodeAudio(bytes.toString('base64')), bytes);
  }
  const mutations = [
    bytes => bytes.writeUInt32LE(0, 4),
    bytes => bytes.writeUInt32LE(1, 28),
    bytes => bytes.writeUInt16LE(1, 32),
    bytes => { bytes[0] |= 0x80; },
    bytes => { bytes[8] |= 0x80; },
    bytes => { bytes[12] |= 0x80; },
    bytes => { bytes[36] |= 0x80; },
    bytes => {
      const odd = bytes.subarray(0, bytes.length - 1);
      odd.writeUInt32LE(odd.length - 8, 4);
      odd.writeUInt32LE(odd.length - 44, 40);
      return odd;
    },
  ];
  for (const mutate of mutations) {
    const bytes = audio();
    const changed = mutate(bytes);
    assert.throws(() => decodeAudio((Buffer.isBuffer(changed) ? changed : bytes).toString('base64')),
      error => error.status === 400 && /Invalid dictation/.test(error.message));
  }
});

test('damaged UTF-8 cannot become accepted dictated words and uses the existing fallback', async () => {
  const corrupt = Buffer.concat([Buffer.from('{"text":"before '), Buffer.from([0xc3, 0x28]), Buffer.from(' after"}')]);
  await assert.rejects(transcribe(audio(), groq, async () => new Response(corrupt)), unavailable);
  const calls = [];
  const result = await transcribe(audio(), both, async url => {
    calls.push(url);
    return calls.length === 1 ? new Response(corrupt) : Response.json(transcript('Recovered café 世界'));
  });
  assert.equal(result, 'Recovered café 世界');
  assert.equal(calls.length, 2);
});

test('provider refusal bodies are cancelled before fallback and cleanup failures do not block recovery', async () => {
  for (const throws of [false, true]) {
    let cancelled = 0; let calls = 0;
    const result = await transcribe(audio(), both, async () => {
      if (++calls === 2) {
        assert.equal(cancelled, 1);
        return Response.json(transcript('Recovered'));
      }
      return new Response(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode('refused')); },
        cancel() { cancelled++; if (throws) throw new Error('cleanup failed'); },
      }), { status: 429 });
    });
    assert.equal(result, 'Recovered');
    assert.equal(cancelled, 1);
  }
});

test('response readers release ownership after success, invalid JSON, oversized data and read errors', async () => {
  for (const mode of ['valid', 'json', 'large', 'read']) {
    const response = new Response(new ReadableStream({
      start(controller) {
        if (mode === 'read') { controller.error(new Error('disconnected')); return; }
        controller.enqueue(new TextEncoder().encode(mode === 'large' ? 'x'.repeat(256001) :
          mode === 'json' ? '{broken' : '{"text":"Words"}'));
        if (mode !== 'large') controller.close();
      },
    }));
    const run = transcribe(audio(), groq, async () => response);
    if (mode === 'valid') assert.equal(await run, 'Words');
    else await assert.rejects(run, unavailable);
    assert.equal(response.body.locked, false, mode);
  }
});

test('split Unicode, literal replacement characters, silence and transcript caps remain supported', async () => {
  const text = '  café 世界 � \\frac{1}{2}\n```js\ncode\n```  ';
  const bytes = Buffer.from(JSON.stringify({ text }));
  const split = bytes.indexOf(Buffer.from('é')) + 1;
  const response = new Response(new ReadableStream({ start(controller) {
    controller.enqueue(bytes.subarray(0, split)); controller.enqueue(bytes.subarray(split)); controller.close();
  } }));
  assert.equal(await transcribe(audio(), groq, async () => response), text.trim());
  for (const text of ['', ' '.repeat(10), 'a'.repeat(13000)]) {
    assert.equal(await transcribe(audio(), groq, async () => Response.json({ text })), text.trim().slice(0, 12000));
    assert.equal(await transcribe(audio(), gemini, async () => Response.json(transcript(text))), text.trim().slice(0, 12000));
  }
});

test('bounded responses accept the byte limit exactly and cancel an oversized live stream', async () => {
  const prefix = '{"text":"ok","padding":"';
  const suffix = '"}';
  const atLimit = prefix + ' '.repeat(256000 - prefix.length - suffix.length) + suffix;
  assert.equal(await transcribe(audio(), groq, async () => new Response(atLimit)), 'ok');
  let cancelled = 0;
  await assert.rejects(transcribe(audio(), groq, async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(256001)); },
    cancel() { cancelled++; },
  }))), unavailable);
  assert.equal(cancelled, 1);
});

test('malformed provider shapes and broken streams stay controlled and allow a later valid request', async () => {
  for (const body of [null, [], {}, { text: 42 }, { candidates: [null] }, { candidates: [{ content: { parts: [null] } }] }]) {
    for (const env of [groq, gemini])
      await assert.rejects(transcribe(audio(), env, async () => Response.json(body)), unavailable);
  }
  assert.equal(await transcribe(audio(), groq, async () => Response.json({ text: 'Recovered' })), 'Recovered');
});

test('provider request configuration, audio bytes and Gemini thought filtering are preserved', async () => {
  const bytes = audio();
  let calls = 0;
  const text = await transcribe(bytes, both, async (url, init) => {
    assert.ok(init.signal instanceof AbortSignal);
    assert.equal(init.method, 'POST');
    if (++calls === 1) {
      assert.match(url, /api\.groq\.com/);
      assert.equal(init.headers.Authorization, 'Bearer offline-groq');
      assert.equal(init.body.get('model'), 'whisper-large-v3-turbo');
      assert.deepEqual(Buffer.from(await init.body.get('file').arrayBuffer()), bytes);
      throw new TypeError('network failed');
    }
    assert.match(url, /gemini-2\.5-flash:generateContent$/);
    assert.equal(init.headers['x-goog-api-key'], 'offline-gemini');
    const body = JSON.parse(init.body);
    assert.deepEqual(body.generationConfig, { temperature: 0, maxOutputTokens: 4096 });
    assert.equal(body.contents[0].parts[1].inlineData.data, bytes.toString('base64'));
    return Response.json({ candidates: [{ content: { parts: [
      { thought: true, text: 'private reasoning' }, { text: ' café ' }, { inlineData: {} }, { text: '世界 ' },
    ] } }] });
  });
  assert.equal(text, 'café 世界');
  assert.equal(calls, 2);
});

test('authenticated transcription rejects malformed audio before provider access and recovers on retry', async t => {
  const env = { APP_ORIGIN: 'https://vaelo.example', SESSION_SECRET: 's'.repeat(64),
    ALLOWED_EMAIL: 'owner@example.com', GROQ_API_KEY: 'offline-groq', GEMINI_API_KEY: '' };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => { for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } });
  t.mock.method(devices, 'verify', async () => true);
  t.mock.method(revocations, 'epoch', async () => 0);
  const cfg = settings();
  const token = await signSession({ sub: 'offline-owner', email: cfg.email, name: 'Owner' },
    { ...cfg, devices: { register: async () => undefined } }, 'vaelo-desktop');
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async url => {
    calls++; assert.equal(url, 'https://api.groq.com/openai/v1/audio/transcriptions');
    return calls === 1 ? new Response(Buffer.from('{"text":"\xc3("}', 'latin1')) : Response.json({ text: 'Retry café 世界' });
  });
  const call = async (bytes, headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }) => {
    const res = { setHeader() {}, end(value) { this.body = JSON.parse(value); } };
    await handler({ method: 'POST', headers, body: { audio: bytes.toString('base64') } }, res);
    return res;
  };
  const invalid = audio(); invalid.writeUInt32LE(0, 4);
  assert.equal((await call(invalid)).statusCode, 400);
  assert.equal((await call(audio(), {})).statusCode, 401);
  assert.equal(calls, 0);
  const damaged = await call(audio());
  assert.equal(damaged.statusCode, 503);
  assert.match(damaged.body.error, /Try again/);
  const recovered = await call(audio());
  assert.equal(recovered.statusCode, 200);
  assert.deepEqual(recovered.body, { text: 'Retry café 世界' });
  assert.equal(calls, 2);
});
