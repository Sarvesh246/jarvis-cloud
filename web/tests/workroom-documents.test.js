import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { exportWork, importWork } from '../src/lib/workroom.js';
import { getWorkspace } from '../shared/workspaces.js';
import { getCheck } from '../shared/checks.js';

// Exercise the component's actual async handlers with render snapshots and
// controllable reads. Account changes share refs just as React renders do.
const source = readFileSync(new URL('../src/components/Workroom.jsx', import.meta.url), 'utf8');
const ownerState = source.slice(source.indexOf('  const sub ='), source.indexOf('  const [records,'));
const documents = source.slice(source.indexOf('  async function loadTexts('), source.indexOf('  async function mutate('));
const imports = source.slice(source.indexOf('  async function importFile('), source.indexOf('  function leaveTask('));
const previewState = source.slice(source.indexOf('  if (previewDraft.current'), source.indexOf('  const workspace ='));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const record = (id = 'first') => ({ id, workspaceId: 'custom', title: id, documents: [{ id: `${id}-doc`, sha: `${id}-sha`, name: `${id}.md`, slot: 'extra' }] });
const content = 'café 漢字\n$x^2$\n| A | B |\n|---|---|\n```js\nrun()\n```';

function fixture({ download = async () => true } = {}) {
  const requests = [], downloads = [], writes = [], events = [];
  const refs = { account: { current: null }, documentSession: { current: { sub: null, active: true } }, previewSequence: { current: 0 }, previewDraft: { current: null }, texts: { current: {} } };
  let state = {};
  const sandbox = { ...refs, exportWork, importWork, lookups: { getWorkspace, getCheck }, encodeURIComponent, SyntaxError,
    plural: (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`,
    requestWork(body, options) { const pending = deferred(); requests.push({ ...pending, body, options }); return pending.promise; },
    writeDocumentCache(...args) { writes.push(args); },
    async download(data, name) { downloads.push({ data, name }); return download(data, name); },
  };
  for (const key of ['Busy', 'Problem', 'Status', 'Preview', 'Imports']) sandbox[`set${key}`] = value => { state[key.toLowerCase()] = value; events.push([key, value]); };
  function render(sub = 'A', { draft = record(), offline = false, preview = null, texts } = {}) {
    if (refs.account.current !== sub) { refs.texts.current = texts || {}; state = {}; }
    return runInNewContext(`(() => { ${ownerState}\n${previewState}\n${documents}\n${imports}\nreturn {loadTexts, togglePreview, exportRecords, importFile}; })()`,
      { ...sandbox, session: { user: { sub }, csrf: sub }, draft, saved: draft, records: [draft], offline, preview });
  }
  return { ...refs, requests, downloads, writes, events, render, get state() { return state; } };
}

test('late document responses cannot repopulate another account, including sign-out and return', async () => {
  for (const returnToOwner of [false, true]) {
    const f = fixture(), old = f.render();
    const pending = old.loadTexts(record());
    f.render(null); f.render('B'); if (returnToOwner) f.render('A');
    f.texts.current = { 'new-sha': 'Current account' };
    f.requests[0].resolve({ documents: { 'first-sha': content } });
    await pending;
    assert.deepEqual(f.texts.current, { 'new-sha': 'Current account' });
    assert.equal(f.writes.length, 0);
  }
});

test('an obsolete backup stops before downloading or fetching another record', async () => {
  const f = fixture(), old = f.render();
  const pending = old.exportRecords([record(), record('second')], 'private-backup');
  f.render('B'); f.state.busy = 'save';
  f.requests[0].resolve({ documents: { 'first-sha': content } });
  await new Promise(setImmediate);
  // Resolve any incorrectly started extra request so the original code settles.
  f.requests[1]?.resolve({ documents: { 'second-sha': 'Other document' } });
  await pending;
  assert.equal(f.requests.length, 1);
  assert.equal(f.downloads.length, 0);
  assert.equal(f.state.busy, 'save', 'old finally must not clear the current operation');
  assert.equal(f.state.status, undefined);
});

test('completed or failed old downloads do not update the current account', async () => {
  for (const fails of [false, true]) {
    const downloading = deferred();
    const f = fixture({ download: () => downloading.promise }), old = f.render();
    f.texts.current = { 'first-sha': content };
    // A desktop save dialog can stay open while the session changes.
    // Supply its promise through the same download function used by the handler.
    const pending = old.exportRecords([record()], 'backup');
    await new Promise(setImmediate);
    f.render('B'); f.state.busy = 'loading';
    if (fails) downloading.reject(new Error('Old save error'));
    else downloading.resolve(true);
    await pending;
    assert.equal(f.downloads.length, 1);
    assert.equal(f.state.status, undefined);
    assert.equal(f.state.busy, 'loading');
  }
});

test('obsolete preview success and failure cannot appear in another account', async () => {
  for (const fail of [false, true]) {
    const f = fixture(), old = f.render();
    const pending = old.togglePreview(record().documents[0]);
    f.render('B');
    if (fail) f.requests[0].reject(new Error('Old network error'));
    else f.requests[0].resolve({ documents: { 'first-sha': content } });
    await pending;
    assert.equal(f.state.preview, undefined);
  }
});

test('preview selection follows the latest file and workspace, rather than response order', async () => {
  const f = fixture(), old = f.render('A', { draft: { ...record(), documents: ['first', 'second', 'third'].map(id => record(id).documents[0]) } });
  const first = old.togglePreview(record().documents[0]);
  const second = old.togglePreview(record('second').documents[0]);
  f.requests[1].resolve({ documents: { 'second-sha': 'Second' } }); await second;
  f.requests[0].resolve({ documents: { 'first-sha': content } }); await first;
  assert.equal(f.state.preview.id, 'second-doc');
  const third = old.togglePreview(record('third').documents[0]);
  f.render('A', { draft: record('different-workspace') });
  f.render('A');
  f.requests[2].resolve({ documents: { 'third-sha': 'Third' } }); await third;
  assert.equal(f.state.preview.id, 'second-doc');
});

test('delayed imports and import errors stay in their account session', async () => {
  for (const fail of [false, true]) {
    const f = fixture(), old = f.render(), reading = deferred();
    const event = { target: { value: 'selected.json', files: [{ size: 100, text: () => reading.promise }] } };
    const pending = old.importFile(event);
    assert.equal(event.target.value, '');
    f.render('B'); f.render('A');
    if (fail) reading.reject(new Error('Old read error'));
    else reading.resolve(JSON.stringify({ workspaceId: 'custom', title: 'Private', documents: [] }));
    await pending;
    assert.deepEqual(f.state, {});
  }
});

test('normal document previews, backups and imports preserve complete content', async () => {
  const f = fixture(), current = f.render();
  const preview = current.togglePreview(record().documents[0]);
  f.requests[0].resolve({ documents: { 'first-sha': content, ignored: null } }); await preview;
  assert.equal(f.state.preview.text, content);
  assert.equal(f.writes.length, 1);
  await current.exportRecords([record()], 'my-backup');
  assert.equal(f.requests.length, 1, 'cached documents need no additional request');
  assert.equal(f.downloads[0].data.records[0].documents[0].text, content);
  const event = { target: { value: 'backup.json', files: [{ size: 100, text: async () => JSON.stringify(f.downloads[0].data) }] } };
  await current.importFile(event);
  assert.equal(f.state.imports[0].documents[0].text, content);
  assert.equal(f.state.imports[0].id, undefined, 'imports remain review drafts');
  assert.equal(f.state.busy, '');
});

test('failed and cancelled downloads settle without a false success and allow retry', async () => {
  for (const result of ['failure', 'cancel']) {
    let first = true;
    const f = fixture({ download: async () => {
      if (!first) return true;
      first = false;
      if (result === 'failure') throw new Error('Disk unavailable');
      return false;
    } }), current = f.render();
    f.texts.current = { 'first-sha': content };
    await current.exportRecords([record()], 'backup');
    assert.equal(f.state.busy, '');
    assert.equal(f.state.status, undefined);
    if (result === 'failure') assert.match(f.state.problem, /couldn’t be saved.*try again/i);
    else assert.equal(f.state.problem, '');
    await current.exportRecords([record()], 'backup');
    assert.equal(f.state.problem, '');
    assert.equal(f.state.status, 'Backup saved to your downloads.');
  }
});

test('offline and failed document retrieval retain explicit missing-file markers', async () => {
  for (const offline of [true, false]) {
    const f = fixture(), current = f.render('A', { offline });
    const pending = current.exportRecords([record()], 'backup');
    if (!offline) f.requests[0].reject(new Error('Network unavailable'));
    await pending;
    assert.equal(f.downloads[0].data.records[0].documents[0].missing, true);
    assert.match(f.state.status, /1 file.*couldn’t be added/);
    assert.equal(f.state.status.includes('offline'), offline, 'online retrieval failures must not claim the device is offline');
    assert.throws(() => importWork(JSON.stringify(f.downloads[0].data), { getWorkspace, getCheck }), /missing/i);
  }
});

test('hiding a preview invalidates outstanding selections and keeps normal truncation', async () => {
  const f = fixture(), current = f.render();
  const pending = current.togglePreview(record().documents[0]);
  const visible = f.render('A', { preview: { id: 'first-doc', text: 'Old' } });
  await visible.togglePreview(record().documents[0]);
  f.requests[0].resolve({ documents: { 'first-sha': 'x'.repeat(6500) } }); await pending;
  assert.equal(f.state.preview, null);
  await current.togglePreview(record().documents[0]);
  assert.equal(f.state.preview.text, `${'x'.repeat(6000)}\n\n…`);
});

test('unmounted document operations cannot write caches or download a backup', async () => {
  const f = fixture(), current = f.render();
  const pending = current.exportRecords([record()], 'backup');
  f.documentSession.current.active = false;
  f.requests[0].resolve({ documents: { 'first-sha': content } });
  await pending;
  assert.equal(f.downloads.length, 0);
  assert.equal(f.writes.length, 0);
});
