import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');

test('Pause during the location wait cancels the reply before it starts', () => {
  const send = app.slice(app.indexOf('async function send('), app.indexOf('async function followReply('));
  assert.ok(send.indexOf('startingRuns.current.set(') < send.indexOf('await placeFor('));
  assert.match(send, /if \(starting\.stopped\) return;/);
  const stop = app.slice(app.indexOf('function stopReply('));
  assert.match(stop.slice(0, 900), /starting\.stopped = true/);
});

test('a followed reply Vaelo has never heard of is given up on, not left thinking', () => {
  assert.match(app, /const ORPHAN_MS = 2 \* 60 \* 1000/);
  assert.match(app, /err\.code === "run_missing" && !received && Date\.now\(\) - startedAt > ORPHAN_MS/);
});

test('a sent reply is claimed and marked busy before the location wait', () => {
  const send = app.slice(app.indexOf('async function send('), app.indexOf('async function followReply('));
  const claim = send.indexOf('rememberLiveReply(id, chatId)');
  const busy = send.indexOf('setLive(');
  const wait = send.indexOf('await placeFor(');
  assert.ok(claim > 0 && busy > 0 && wait > 0);
  assert.ok(claim < wait, 'unclaimed, the cross-device mirror effect takes the new reply for another device\'s');
  assert.ok(busy < wait, 'the Pause button and live line depend on the conversation being busy');
});
