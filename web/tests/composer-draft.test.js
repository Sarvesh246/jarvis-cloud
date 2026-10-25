import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createComposerDraft } from '../src/lib/composer-draft.js';

test('draft writes are immediately readable by send and conversation switching', () => {
  const draft = createComposerDraft();
  draft.set('First');
  draft.set(value => `${value} edit`);
  draft.set(value => `> Quote\n\n${value}`);
  assert.equal(draft.getSnapshot(), '> Quote\n\nFirst edit');
  assert.equal(draft.hasText(), true);
  draft.set('');
  assert.equal(draft.getSnapshot(), '');
  assert.equal(draft.hasText(), false);
});

test('shell snapshot only changes when a draft gains or loses words', () => {
  const draft = createComposerDraft();
  const changes = [], words = [];
  let snapshot = draft.hasText();
  draft.subscribe(() => {
    words.push(draft.getSnapshot());
    const next = draft.hasText();
    if (next !== snapshot) { changes.push(next); snapshot = next; }
  });
  for (const text of [' ', 'H', 'He', 'Hello', 'Hello 日本語 👋', 'Hello 日本語 👋', '\n\t']) draft.set(text);
  assert.deepEqual(changes, [true, false]);
  assert.deepEqual(words, [' ', 'H', 'He', 'Hello', 'Hello 日本語 👋', '\n\t']);
});

test('unmounted subscribers and different app instances cannot receive another draft', () => {
  const first = createComposerDraft(), second = createComposerDraft();
  let calls = 0;
  const unsubscribe = first.subscribe(() => calls++);
  first.set('Kept while switching');
  unsubscribe();
  first.set('Restored');
  second.set('Other account');
  assert.equal(calls, 1);
  assert.equal(first.getSnapshot(), 'Restored');
  assert.equal(second.getSnapshot(), 'Other account');
});
