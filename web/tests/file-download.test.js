import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Run the actual download functions with deterministic browser/native failures.
const after = readFileSync(new URL('../src/components/blocks/AfterUI.jsx', import.meta.url), 'utf8');
const source = readFileSync(new URL('../src/lib/file-download.js', import.meta.url), 'utf8').replace(/^import .*;\r?\n/, '').replaceAll('export ', '');
const saveButton = after.slice(after.indexOf('export function SaveButton('), after.indexOf('export function CopyButton('));
const saveHandler = saveButton.slice(saveButton.indexOf('onClick={') + 'onClick={'.length, saveButton.indexOf('\n    >')).trim().replace(/\}$/, '');

function fixture({ fail = '', native = false, nativeSave = async () => true } = {}) {
  const links = [], blobs = [], revoked = [], timers = [], alerts = [];
  const sandbox = {
    DESKTOP: native, saveDesktopFile: nativeSave, Blob,
    alert: message => alerts.push(message),
    setTimeout: callback => timers.push(callback),
    URL: {
      createObjectURL(blob) { if (fail === 'url') throw Error('No URLs'); blobs.push(blob); return `blob:${blobs.length}`; },
      revokeObjectURL(url) { revoked.push(url); },
    },
    document: {
      createElement() {
        if (fail === 'create') throw Error('Cannot create');
        const link = { attached: false, removed: false, click() { if (fail === 'click') throw Error('Cannot download'); }, remove() { this.removed = true; this.attached = false; } };
        links.push(link); return link;
      },
      body: { append(link) { if (fail === 'append') throw Error('Cannot append'); link.attached = true; } },
    },
  };
  const { download, downloadBlob } = runInNewContext(`${source}\n({ download, downloadBlob })`, sandbox);
  const save = runInNewContext(`(${saveHandler})`, { ...sandbox, download, name: 'vaelo-qr.svg', text: '<svg>é</svg>', type: 'image/svg+xml' });
  return { download, downloadBlob, save, links, blobs, revoked, timers, alerts, flush() { timers.splice(0).forEach(fn => fn()); } };
}

test('browser export failures are contained and every allocated URL is released', async () => {
  for (const fail of ['url', 'create', 'append', 'click']) {
    const f = fixture({ fail });
    await assert.doesNotReject(async () => f.download('reply.md', '# café', 'text/markdown'), fail);
    f.flush();
    assert.equal(f.alerts.length, 1, fail);
    assert.equal(f.revoked.length, f.blobs.length, fail);
    assert.ok(f.links.every(link => !link.attached), fail);
  }
});

test('structured artifact save failures settle instead of rejecting their click handler', async () => {
  for (const options of [{ native: true, nativeSave: async () => { throw Error('Disk full'); } }, { fail: 'click' }]) {
    const f = fixture(options);
    await assert.doesNotReject(f.save());
    f.flush();
    assert.equal(f.alerts.length, 1);
    assert.equal(f.revoked.length, f.blobs.length);
  }
});

test('successful exports retain UTF-8 content, filenames, MIME types and delayed cleanup', async () => {
  const f = fixture();
  const content = '# café 漢字\n\n$x^2$\n```js\nrun()\n```\n';
  await f.download('reply.md', content, 'text/markdown');
  assert.equal(await f.blobs[0].text(), content);
  assert.equal(f.blobs[0].type, 'text/markdown;charset=utf-8');
  assert.equal(f.links[0].download, 'reply.md');
  assert.equal(f.links[0].removed, true);
  assert.deepEqual(f.revoked, []);
  f.flush(); assert.deepEqual(f.revoked, ['blob:1']);
  await f.download('table.csv', 'City,Cost\r\nCafé,€5', 'text/csv');
  assert.equal(await f.blobs[1].text(), 'City,Cost\r\nCafé,€5'); // Blob.text strips BOM.
  assert.deepEqual([...new Uint8Array(await f.blobs[1].arrayBuffer()).slice(0, 3)], [239, 187, 191]);
});

test('native cancellation is quiet and save failure permits later recovery', async () => {
  let attempts = 0;
  const calls = [], f = fixture({ native: true, nativeSave: async (...args) => { calls.push(args); if (++attempts === 1) throw Error('Disk full'); return attempts > 2; } });
  assert.equal(await f.download('a.md', 'é', 'text/markdown'), false);
  assert.equal(await f.download('a.md', 'é', 'text/markdown'), false);
  assert.equal(await f.download('a.md', 'é', 'text/markdown'), true);
  assert.equal(f.alerts.length, 1);
  assert.deepEqual(calls, [['a.md', 'é'], ['a.md', 'é'], ['a.md', 'é']]);
  assert.equal(f.blobs.length, 0);
});

test('CSV exports do not duplicate an existing BOM or change source text', async () => {
  const f = fixture(), text = '\uFEFFLabel,Value\r\n"café, 漢字",€5';
  await f.download('table.csv', text, 'text/csv');
  const bytes = new Uint8Array(await f.blobs[0].arrayBuffer());
  assert.deepEqual(bytes, new TextEncoder().encode(text));
});

test('binary downloads preserve bytes and attach the anchor before dispatch', async () => {
  const f = fixture(), bytes = new Uint8Array([137, 80, 78, 71, 0, 255]);
  // Observe the connected link at click time, as browsers that require it do.
  const oldPush = f.links.push.bind(f.links);
  f.links.push = link => { const click = link.click; link.click = () => { assert.equal(link.attached, true); click(); }; return oldPush(link); };
  f.downloadBlob('vaelo-image.png', new Blob([bytes], { type: 'image/png' }));
  assert.equal(f.links[0].download, 'vaelo-image.png');
  assert.equal(f.blobs[0].size, bytes.length);
  assert.deepEqual(new Uint8Array(await f.blobs[0].arrayBuffer()), bytes);
  assert.equal(f.blobs[0].type, 'image/png');
  assert.equal(f.links[0].removed, true);
  f.flush(); assert.deepEqual(f.revoked, ['blob:1']);
});

test('image download failure clears busy state, reports locally and releases the URL', async () => {
  const image = after.slice(after.indexOf('export function ImageDownload('), after.indexOf('function FactIcon('));
  const handler = image.slice(image.indexOf('onClick={') + 'onClick={'.length, image.indexOf('}}><DownloadSimple') + 1);
  for (const fail of ['', 'click']) {
    const f = fixture({ fail }), saving = [], problems = [];
    const save = runInNewContext(`(${handler})`, {
      src: 'https://example.com/picture.png', DESKTOP: false, Blob, downloadBlob: f.downloadBlob,
      imageDownload: async () => ({ name: 'vaelo-image.png', mime: 'image/png', bytes: new Uint8Array([0, 255]) }),
      setSaving: value => saving.push(value), setProblem: value => problems.push(value),
    });
    await assert.doesNotReject(save());
    assert.deepEqual(saving, [true, false]);
    assert.equal(problems.at(-1), fail ? 'Could not save the image. Open the original to save it.' : '');
    f.flush(); assert.deepEqual(f.revoked, ['blob:1']);
    assert.equal(f.alerts.length, 0, 'image failures use the existing inline message');
  }
});

test('phone conversation export reports success only after a completed download', async () => {
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const handler = app.slice(app.indexOf('onShare={async () => {') + 'onShare={'.length, app.indexOf('\n              onRemove=', app.indexOf('onShare={async () => {'))).trim().replace(/\}$/, '');
  const text = 'You: café 漢字\nVaelo: $x^2$\n```js\nrun()\n```';
  for (const result of [false, true]) {
    const calls = [], toasts = [];
    let settle;
    const sharing = runInNewContext(`(${handler})`, {
      setSheet() {}, displayChatTitle: () => 'My conversation', transcriptOf: () => text, active: {}, navigator: {},
      download: (...args) => { calls.push(args); return new Promise(resolve => { settle = () => resolve(result); }); },
      showToast: value => toasts.push(value),
    });
    const pending = sharing();
    assert.equal(toasts.length, 0, 'pending native save is not a completed export');
    settle(); await pending;
    assert.equal(toasts.length, Number(result));
    assert.equal(calls[0][0], 'My-conversation.md');
    assert.equal(calls[0][1], `# My conversation\n\n${text}\n`);
    assert.equal(calls[0][2], 'text/markdown');
  }
});
