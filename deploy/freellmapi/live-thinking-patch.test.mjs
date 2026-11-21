import test from 'node:test';
import assert from 'node:assert/strict';
import { patchLiveThinking, LIVE_THINKING_AFTER_MS } from './live-thinking-patch.mjs';

const pinned = `              if (choice.delta && Object.keys(choice.delta).some(k => k !== 'content')) {
                const cleaned = { ...anyChunk };
                if (headerSent) writeChunk(cleaned); else preamble.push(cleaned);
              }`;

test('thinking streams once a model has thought for a moment; short thoughts stay held', () => {
  const patched = patchLiveThinking(pinned);
  assert.match(patched, /preamble\.push\(cleaned\);/);
  assert.match(patched, /reasoning\.length > 0 && mode === 'undecided'/);
  assert.match(patched, /!samplingParams\.response_format/, 'structured output keeps holding everything');
  assert.match(patched, new RegExp(`Date\\.now\\(\\) - start >= ${LIVE_THINKING_AFTER_MS}\\) flushHeaders\\(\\)`));
  assert.equal(patchLiveThinking(patched), patched, 'applying twice changes nothing');
  assert.throws(() => patchLiveThinking('changed upstream'), /contract changed/);
});

test('the patched hold behaves as intended', () => {
  // Execute the patched branch in isolation with stand-ins for the proxy state.
  const body = patchLiveThinking(pinned).split('\n').slice(2, -1).join('\n');
  const run = ({ headerSent = false, reasoning = 'thinking', mode = 'undecided', json = false, elapsed = 0 }) => {
    const calls = { flushed: 0, written: 0, held: [] };
    const fn = new Function('headerSent', 'writeChunk', 'preamble', 'cleaned', 'reasoning', 'mode', 'samplingParams', 'start', 'flushHeaders', body);
    fn(headerSent, () => calls.written++, calls.held, {}, reasoning, mode, json ? { response_format: {} } : {},
      Date.now() - elapsed, () => calls.flushed++);
    return calls;
  };
  assert.equal(run({ elapsed: 200 }).flushed, 0, 'a short thought stays held');
  assert.equal(run({ elapsed: 2000 }).flushed, 1, 'a long thought starts streaming');
  assert.equal(run({ elapsed: 2000, json: true }).flushed, 0);
  assert.equal(run({ elapsed: 2000, reasoning: '' }).flushed, 0, 'role-only preamble never commits');
  assert.equal(run({ elapsed: 2000, mode: 'dialect' }).flushed, 0);
  assert.equal(run({ headerSent: true }).written, 1, 'after commit, chunks pass straight through');
});
