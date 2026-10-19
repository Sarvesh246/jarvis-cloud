import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');

test('a sent reply is claimed and marked busy before the location wait', () => {
  const send = app.slice(app.indexOf('async function send('), app.indexOf('async function followReply('));
  const claim = send.indexOf('rememberLiveReply(id, chatId)');
  const busy = send.indexOf('setLive(');
  const wait = send.indexOf('await placeFor(');
  assert.ok(claim > 0 && busy > 0 && wait > 0);
  assert.ok(claim < wait, 'unclaimed, the cross-device mirror effect takes the new reply for another device\'s');
  assert.ok(busy < wait, 'the Pause button and live line depend on the conversation being busy');
});
