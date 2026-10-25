import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createComposerDraft } from '../src/lib/composer-draft.js';

// Exercise the real App handler while React batches several navigation calls.
const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const selection = app.slice(app.indexOf('  function selectChat('), app.indexOf('  /* Renames, pins'));
function fixture(text = '', files = []) {
  const draftStore = createComposerDraft();
  draftStore.set(text);
  const drafts = { current: new Map() }, attachmentList = { current: files };
  const writing = { current: { chatId: 'a', attachments: files } };
  let activeId = 'a';
  const selectChat = runInNewContext(`${selection}\nselectChat`, {
    writing, draftStore, drafts, attachmentList, pinned: { current: false },
    setDraft: draftStore.set,
    setAttachments: files => { attachmentList.current = files; },
    setActiveId: id => { activeId = id; },
    setAway() {}, setSaved() {}, setError() {}, setMenu() {}, setWorkspace() {}, setQuote() {},
    textarea: { current: { focus() {} } },
  });
  return { selectChat, drafts: drafts.current, draftStore, writing, attachmentList,
    render() { writing.current = { chatId: activeId, attachments: attachmentList.current }; },
  };
}
const file = id => ({ id, state: 'ready', kind: 'file', body: `Keep ${id} 日本語 $x$` });

test('a batched round trip restores the original text and attachment identities', () => {
  const attachment = file('a-file'), f = fixture('Unsent **draft** 👋\n```js\nx()\n```', [attachment]);
  f.selectChat('b');
  f.selectChat('a');
  assert.equal(f.draftStore.getSnapshot(), 'Unsent **draft** 👋\n```js\nx()\n```');
  assert.equal(f.attachmentList.current[0], attachment);
  assert.equal(f.drafts.has('a'), false);
});

test('repeated selection of the destination cannot stash its draft under the source', () => {
  const f = fixture('Original');
  f.drafts.set('b', { draft: 'Destination', attachments: [file('b-file')] });
  f.selectChat('b'); f.selectChat('b'); f.render();
  assert.equal(f.draftStore.getSnapshot(), 'Destination');
  assert.equal(f.attachmentList.current[0].id, 'b-file');
  assert.equal(f.drafts.get('a').draft, 'Original');
  assert.equal(f.drafts.has('b'), false);
});

test('three batched switches keep edits and files with each synchronous owner', () => {
  const a = file('a-file'), b = file('b-file'), c = file('c-file');
  const f = fixture('A', [a]);
  f.drafts.set('b', { draft: 'B', attachments: [b] });
  f.drafts.set('c', { draft: 'C', attachments: [c] });
  f.selectChat('b'); f.draftStore.set(text => `${text} edited`);
  f.selectChat('c'); f.selectChat('a');
  assert.equal(f.draftStore.getSnapshot(), 'A');
  assert.equal(f.attachmentList.current[0], a);
  assert.equal(f.drafts.get('b').draft, 'B edited');
  assert.equal(f.drafts.get('b').attachments[0], b);
  assert.equal(f.drafts.get('c').draft, 'C');
  assert.equal(f.drafts.get('c').attachments[0], c);
});

test('attachment-only drafts and pending reads survive a batched round trip', () => {
  const reading = { id: 'pending', state: 'reading', kind: 'image' };
  const f = fixture('', [reading]);
  f.selectChat('b'); f.selectChat('a');
  assert.equal(f.attachmentList.current[0], reading);
  assert.equal(f.draftStore.getSnapshot(), '');
});

test('ordinary switches preserve literal text and the existing command discard policy', () => {
  for (const text of ['Text', '日本語 👋', '> quote\n\n$x$', ' /help', '/usr/bin', '/help', '  ']) {
    const f = fixture(text, [file('kept')]);
    f.selectChat('b'); f.render(); f.selectChat('a'); f.render();
    const command = /^\/[a-z][a-z0-9-]*(?:\s|$)/i.test(text);
    assert.equal(f.draftStore.getSnapshot(), command ? '' : text);
    assert.equal(f.attachmentList.current[0].id, 'kept');
    assert.equal(f.drafts.size, 0);
  }
});

test('a switch publishes the destination owner before draft subscribers run', () => {
  const f = fixture('Source'), owners = [];
  f.draftStore.subscribe(() => owners.push(f.writing.current.chatId));
  f.selectChat('b');
  assert.deepEqual(owners, ['b']);
});

test('draft subscribers observe the restored files alongside the new owner', () => {
  const f = fixture('A', [file('a-file')]);
  const destination = [file('b-file')];
  f.drafts.set('b', { draft: 'B', attachments: destination });
  f.draftStore.subscribe(() => {
    assert.equal(f.writing.current.chatId, 'b');
    assert.equal(f.attachmentList.current, destination);
    assert.equal(f.writing.current.attachments, destination);
  });
  f.selectChat('b');
});
