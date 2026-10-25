import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createComposerDraft } from '../src/lib/composer-draft.js';

// Run App's actual ingestion handler with a render snapshot and delayed reads.
const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const state = app.slice(app.indexOf('  const [attachments,'), app.indexOf('  /* What was being written'));
const selection = app.slice(app.indexOf('  function selectChat('), app.indexOf('  /* Renames, pins'))
const handler = app.slice(app.indexOf('  async function addFiles('), app.indexOf('  function checkSelection('));
function fixture(initial = [], { guest = false } = {}) {
  let rendered = initial, serial = 0, focused = 0;
  const reads = [], notices = [], images = new Map(), drafts = new Map();
  const writing = { current: { chatId: 'first', attachments: initial } };
  const draftStore = createComposerDraft();
  const api = runInNewContext(`${state}\n${handler}\n${selection}\n({addFiles, setAttachments, removeAttachment, selectChat})`, {
    useState: () => [initial, value => { rendered = typeof value === 'function' ? value(rendered) : value; }],
    useRef: value => ({ current: value }), useCallback: fn => fn,
    crypto: { randomUUID: () => `file-${++serial}` }, guest,
    IMAGE_LIMIT: 4, activeId: 'first', writing, pinned: {current:false},
    setAway(){}, draftStore, setDraft: draftStore.set, setActiveId(){}, setSaved(){}, setError(){}, setMenu(){}, setWorkspace(){}, setQuote(){},
    isImage: file => file.kind === 'image',
    readAttachment(file) { return new Promise((resolve, reject) => reads.push({ file, resolve, reject })); },
    showToast: value => notices.push(value.text), imageData: { current: images },
    drafts: { current: drafts }, textarea: { current: { focus: () => focused++ } },
  });
  return { ...api, reads, notices, images, drafts, writing, draftStore,
    get items() { return rendered; }, get focused() { return focused; },
    finish() { for (const read of reads) read.resolve(read.file.kind === 'image'
      ? { kind: 'image', state: 'ready', data: `full:${read.file.name}`, thumb: 'small' }
      : { state: 'ready', body: 'Text with café, $x$ and ```code```' }); },
  };
}
const files = (count, kind = 'file') => Array.from({length:count}, (_, i) => ({name:`${kind}-${i}`,size:10,kind}));

test('overlapping file additions reserve the eight slots before another render', async () => {
  const f = fixture();
  const first = f.addFiles(files(5)), second = f.addFiles(files(5));
  assert.equal(f.items.length, 8);
  assert.equal(f.reads.length, 8);
  assert.match(f.notices.join(), /2 were left out/);
  f.finish(); await Promise.all([first, second]);
  assert.ok(f.items.every(item => item.state === 'ready'));
  assert.equal(new Set(f.items.map(item => item.id)).size, 8);
});

test('overlapping image additions cannot bypass the four image limit', async () => {
  const f = fixture();
  const first = f.addFiles(files(3, 'image')), second = f.addFiles(files(3, 'image'));
  assert.equal(f.reads.length, 4);
  f.finish(); await Promise.all([first, second]);
  assert.equal(f.items.filter(item => item.state === 'ready').length, 4);
  assert.equal(f.items.filter(item => item.state === 'unsupported').length, 2);
  assert.equal(f.images.size, 4);
  assert.ok(f.items.filter(item => item.state === 'ready').every(item => !('data' in item)));
});

test('removed images and cleared account drafts cannot repopulate full image memory', async () => {
  for (const clearAccount of [false, true]) {
    const f = fixture();
    const pending = f.addFiles(files(2, 'image'));
    if (clearAccount) { f.setAttachments([]); f.drafts.clear(); f.images.clear(); f.writing.current.chatId = null; }
    else f.setAttachments(current => current.slice(1));
    f.finish(); await pending;
    assert.equal(f.images.size, clearAccount ? 0 : 1);
    assert.equal(f.items.length, clearAccount ? 0 : 1);
  }
});

test('a background draft finishes its own attachments without moving focus', async () => {
  const f = fixture();
  const pending = f.addFiles(files(1, 'image'));
  f.drafts.set('first', { attachments: f.items });
  const destination = [{id:'destination',kind:'file',state:'ready',body:'Keep me'}];
  f.setAttachments(destination); f.writing.current.chatId = 'second';
  f.finish(); await pending;
  assert.deepEqual(f.items, destination);
  assert.equal(f.drafts.get('first').attachments[0].state, 'ready');
  assert.equal(f.images.size, 1);
  assert.equal(f.focused, 0);
});

test('failed reads settle once and a later addition uses released slots', async () => {
  const f = fixture();
  const pending = f.addFiles(files(1));
  f.reads[0].reject(new Error('File disappeared')); await pending;
  assert.equal(f.items[0].state, 'unsupported');
  assert.match(f.items[0].note, /couldn’t be read/);
  f.setAttachments([]);
  const later = f.addFiles(files(8)); f.finish(); await later;
  assert.equal(f.items.length, 8);
  assert.ok(f.items.every(item => item.state === 'ready'));
});

test('guest filtering and ordinary attachment identity and text stay intact', async () => {
  const f = fixture([], { guest: true });
  const pending = f.addFiles([...files(1, 'image'), ...files(1)]);
  assert.equal(f.reads.length, 1);
  f.finish(); await pending;
  assert.equal(f.images.size, 0);
  assert.equal(f.items[0].name, 'file-0');
  assert.equal(f.items[0].size, 10);
  assert.equal(f.items[0].kind, 'file');
  assert.equal(f.items[0].body, 'Text with café, $x$ and ```code```');
  assert.match(f.notices.join(), /Guest mode is text only/);
});


test('removing a ready attachment releases only its own full size image', async () => {
  const f = fixture(); const pending = f.addFiles(files(2, 'image'));
  f.finish(); await pending;
  f.images.set('sent-image', 'Keep previously sent images');
  const removed = f.items[0].id, retained = f.items[1].id;
  f.removeAttachment(removed);
  assert.equal(f.images.has(removed), false);
  assert.equal(f.images.has(retained), true);
  assert.equal(f.images.has('sent-image'), true);
  assert.equal(f.items.length, 1);
});


test('switching before the render keeps the newly reserved files in their original draft', async () => {
  const f = fixture();
  const pending = f.addFiles(files(1, 'image'));
  f.selectChat('second');
  f.writing.current.chatId = 'second';
  assert.equal(f.items.length, 0);
  assert.equal(f.drafts.get('first').attachments.length, 1);
  f.finish(); await pending;
  assert.equal(f.items.length, 0);
  assert.equal(f.drafts.get('first').attachments[0].state, 'ready');
  assert.equal(f.images.size, 1);
});

test('switching reads the newest keystroke even without a shell render and restores it exactly', () => {
  const f = fixture();
  f.draftStore.set('Half-written');
  f.draftStore.set(text => `${text} final words 日本語 👋`);
  f.selectChat('second');
  assert.equal(f.drafts.get('first').draft, 'Half-written final words 日本語 👋');
  assert.equal(f.draftStore.getSnapshot(), '');
  f.writing.current.chatId = 'second';
  f.draftStore.set('Second draft');
  f.selectChat('first');
  assert.equal(f.draftStore.getSnapshot(), 'Half-written final words 日本語 👋');
  assert.equal(f.drafts.get('second').draft, 'Second draft');
});

test('batched switches and late file completion retain both conversations drafts', async () => {
  const f = fixture();
  f.draftStore.set('First draft');
  const pending = f.addFiles(files(1, 'image'));
  f.selectChat('second');
  f.draftStore.set('Second draft');
  f.selectChat('first');
  f.finish(); await pending;
  assert.equal(f.draftStore.getSnapshot(), 'First draft');
  assert.equal(f.items[0].state, 'ready');
  assert.equal(f.images.get(f.items[0].id), 'full:image-0');
  assert.equal(f.drafts.get('second').draft, 'Second draft');
  f.selectChat('second');
  assert.equal(f.items.length, 0);
  assert.equal(f.draftStore.getSnapshot(), 'Second draft');
  assert.equal(f.drafts.get('first').attachments[0].state, 'ready');
});

test('a read completing immediately after a switch cannot refocus the departed composer', async () => {
  const f = fixture();
  const pending = f.addFiles(files(1));
  f.selectChat('second');
  const focusedAtSwitch = f.focused;
  f.finish(); await pending;
  assert.equal(f.focused, focusedAtSwitch);
  assert.equal(f.items.length, 0);
  assert.equal(f.drafts.get('first').attachments[0].state, 'ready');
});
