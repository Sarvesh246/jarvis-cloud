import test from 'node:test';
import assert from 'node:assert/strict';
import { TEACHING_GUIDANCE, guidance } from '../server/chat.js';

test('teaching guidance asks for a big idea, titled steps, a checked answer and a recap', () => {
  assert.match(TEACHING_GUIDANCE, /Big idea/);
  assert.match(TEACHING_GUIDANCE, /bold title/);
  assert.match(TEACHING_GUIDANCE, /\*\*Answer:\*\*/);
  assert.match(TEACHING_GUIDANCE, /starting values/);
  assert.match(TEACHING_GUIDANCE, /asymptote/);
  assert.match(TEACHING_GUIDANCE, /\*\*Remember\*\*/);
});

test('the full prompt carries the teaching guidance', () => {
  assert.ok(guidance().includes(TEACHING_GUIDANCE));
});
