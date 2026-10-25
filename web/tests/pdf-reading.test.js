import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Exercise the production reader, replacing only PDF.js and browser timers.
const source = readFileSync(new URL('../src/lib/pdf-reader.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace('export async function', 'async function');
const deferred = () => Promise.withResolvers();
const turn = () => new Promise(setImmediate);
const item = (str, y = 100, hasEOL = false) => ({ str, transform: [1, 0, 0, 1, 0, y], hasEOL });
function page(items = [item('Readable text')]) {
  return { reads: 0, cleanups: 0,
    async getTextContent() { this.reads++; return { items }; },
    cleanup() { this.cleanups++; },
  };
}
function fixture({ pages = [page()], promise, destroy = async () => {}, getPage } = {}) {
  const timers = new Map(), requests = [], options = [];
  const pdf = { numPages: pages.length, async getPage(number) {
    requests.push(number); return getPage ? getPage(number) : pages[number - 1];
  } };
  const loading = { promise: promise || Promise.resolve(pdf), destroys: 0,
    destroy() { this.destroys++; return destroy(); } };
  let id = 0;
  const extract = runInNewContext(`${source}\nextractPdf`, {
    Uint8Array, GlobalWorkerOptions: {}, workerUrl: 'local-worker',
    getDocument(value) { options.push(value); return loading; },
    setTimeout(fn, ms) { timers.set(++id, { fn, ms }); return id; },
    clearTimeout(timer) { timers.delete(timer); },
  });
  const state = { status: 'pending' };
  const result = extract(new Uint8Array([1, 2, 3]).buffer).then(
    value => Object.assign(state, { status: 'fulfilled', value }),
    error => Object.assign(state, { status: 'rejected', error }));
  return { result, state, loading, pdf, requests, pages, timers, options,
    expire() { for (const [key, timer] of timers) { timers.delete(key); assert.equal(timer.ms, 15000); timer.fn(); } },
  };
}
const timedOut = f => {
  assert.equal(f.state.status, 'rejected');
  assert.match(f.state.error.message, /took too long.*smaller file/i);
  assert.equal(f.timers.size, 0);
};

test('PDF reader preserves extraction text, page references, warnings and safe PDF.js options', async () => {
  const pages = [page([item('café 東京 🌍'), item('same line'), item('new line', 80, true)]), page([]),
    page([{}, item('const x = 1;'), item('$x^2$ | a | b |')])];
  const f = fixture({ pages }); await f.result;
  assert.equal(f.state.status, 'fulfilled');
  assert.equal(f.state.value.body, '[PDF text extraction only. Images, charts and handwriting are not included.]\n' +
    '[Page 1]\ncafé 東京 🌍 same line \nnew line\n\n' +
    '[Page 2]\n[No extractable text on this page; scanned or visual content is unavailable.]\n\n' +
    '[Page 3]\nconst x = 1; $x^2$ | a | b |');
  assert.equal(f.state.value.note, 'PDF text extracted locally with page references. Visual content is not included.');
  assert.deepEqual(f.requests, [1, 2, 3]);
  assert.deepEqual(pages.map(p => p.cleanups), [1, 1, 1]);
  assert.equal(f.loading.destroys, 1); assert.equal(f.timers.size, 0);
  const options = f.options[0];
  assert.deepEqual([...options.data], [1, 2, 3]);
  for (const key of ['isEvalSupported', 'useSystemFonts', 'disableFontFace', 'stopAtErrors', 'maxImageSize'])
    assert.equal(options[key], { isEvalSupported: false, useSystemFonts: false, disableFontFace: true, stopAtErrors: true, maxImageSize: 0 }[key]);
});

test('PDF deadline settles stalled worker loading and refuses late document work', async () => {
  const pending = deferred(), f = fixture({ promise: pending.promise });
  f.expire(); await turn(); timedOut(f);
  pending.resolve(f.pdf); await turn();
  assert.deepEqual(f.requests, []); assert.equal(f.loading.destroys, 1);
});

test('PDF deadline cleans a late page without starting text extraction', async () => {
  const pending = deferred(), latePage = page(), f = fixture({ getPage: () => pending.promise });
  await turn(); f.expire(); await turn(); timedOut(f);
  pending.resolve(latePage); await turn();
  assert.equal(latePage.reads, 0); assert.equal(latePage.cleanups, 1);
  assert.equal(f.loading.destroys, 1);
});

test('PDF deadline during text extraction cannot process later pages', async () => {
  const pending = deferred(), first = page(), second = page();
  first.getTextContent = () => pending.promise;
  const f = fixture({ pages: [first, second] });
  await turn(); f.expire(); await turn(); timedOut(f);
  pending.resolve({ items: [item('obsolete')] }); await turn();
  assert.deepEqual(f.requests, [1]); assert.equal(first.cleanups, 1);
  assert.equal(second.reads, 0); assert.equal(f.loading.destroys, 1);
});

test('PDF deadline also bounds stalled worker destruction without destroying twice', async () => {
  const pending = deferred(), f = fixture({ destroy: () => pending.promise });
  await turn(); assert.equal(f.state.status, 'pending');
  f.expire(); await turn(); timedOut(f);
  pending.resolve(); await turn(); assert.equal(f.loading.destroys, 1);
});

test('PDF extraction errors survive page and worker cleanup failures', async () => {
  const original = new Error('Damaged page content'), broken = page();
  broken.getTextContent = async () => { throw original; };
  broken.cleanup = () => { broken.cleanups++; throw new Error('Page cleanup failed'); };
  const f = fixture({ pages: [broken], destroy: async () => { throw new Error('Worker cleanup failed'); } });
  await f.result;
  assert.equal(f.state.error, original); assert.equal(broken.cleanups, 1);
  assert.equal(f.loading.destroys, 1); assert.equal(f.timers.size, 0);
});

test('PDF cleanup failure cannot discard successfully extracted source text', async () => {
  const good = page(); good.cleanup = () => { good.cleanups++; throw new Error('Page cleanup failed'); };
  const f = fixture({ pages: [good], destroy: async () => { throw new Error('Worker cleanup failed'); } });
  await f.result;
  assert.equal(f.state.status, 'fulfilled'); assert.match(f.state.value.body, /Readable text/);
  assert.equal(good.cleanups, 1); assert.equal(f.loading.destroys, 1); assert.equal(f.timers.size, 0);
});

test('PDF page-count and unreadable-document errors retain established messages and release workers', async () => {
  for (const [pages, message] of [[Array(201).fill(null), /more than 200 pages/], [[page([]), page([item('  ')])], /no extractable text/]]) {
    const f = fixture({ pages }); await f.result;
    assert.equal(f.state.status, 'rejected'); assert.match(f.state.error.message, message);
    assert.equal(f.loading.destroys, 1); assert.equal(f.timers.size, 0);
    if (pages.length > 200) assert.deepEqual(f.requests, []);
    else assert.deepEqual(pages.map(p => p.cleanups), [1, 1]);
  }
});

test('PDF accumulated text limit releases the failing page and does not read later pages', async () => {
  const pages = [page([item('a'.repeat(80000))]), page([item('b'.repeat(80000))]), page()];
  const f = fixture({ pages }); await f.result;
  assert.equal(f.state.status, 'rejected'); assert.match(f.state.error.message, /Too much PDF text/);
  assert.deepEqual(f.requests, [1, 2]); assert.deepEqual(pages.map(p => p.cleanups), [1, 1, 0]);
  assert.equal(f.loading.destroys, 1); assert.equal(f.timers.size, 0);
});

test('PDF loading errors remain intact when teardown fails', async () => {
  const original = new Error('Password required');
  const f = fixture({ promise: Promise.reject(original), destroy: async () => { throw new Error('Teardown failed'); } });
  await f.result; assert.equal(f.state.error, original);
  assert.equal(f.loading.destroys, 1); assert.equal(f.timers.size, 0);
});

test('PDF late failures after a deadline are observed and independent reads remain usable', async () => {
  const pending = deferred(), slow = fixture({ promise: pending.promise }), fast = fixture();
  await fast.result; slow.expire(); await turn(); timedOut(slow);
  pending.reject(new Error('Late worker failure')); await turn();
  assert.equal(fast.state.status, 'fulfilled'); assert.equal(fast.timers.size, 0);
  assert.equal(slow.loading.destroys, 1); assert.equal(fast.loading.destroys, 1);
});

test('PDF teardown rejects only after timeout without replacing the deadline error', async () => {
  const pending = deferred(), f = fixture({ destroy: () => pending.promise });
  await turn(); f.expire(); await turn(); timedOut(f);
  const original = f.state.error;
  pending.reject(new Error('Late destruction failure')); await turn();
  assert.equal(f.state.error, original); assert.equal(f.loading.destroys, 1);
});

test('PDF synchronous worker teardown errors are contained on success and failure', async () => {
  for (const readable of [true, false]) {
    const f = fixture({ pages: [page(readable ? [item('Source text')] : [])],
      destroy: () => { throw new Error('Worker already closed'); } });
    await f.result;
    assert.equal(f.state.status, readable ? 'fulfilled' : 'rejected');
    if (!readable) assert.match(f.state.error.message, /no extractable text/);
    assert.equal(f.loading.destroys, 1); assert.equal(f.timers.size, 0);
  }
});
