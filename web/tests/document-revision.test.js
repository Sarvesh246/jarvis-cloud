import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { revisionProblem } from '../src/lib/revise.js';
import { addVersion, currentContent, MAX_VERSIONS } from '../src/lib/library.js';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const source = readFileSync(new URL('../src/components/DocumentWork.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const body = source.slice(source.indexOf('function Revise('), source.indexOf('\n  return (\n    <div className="revise"'));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

function fixture() {
  let cursor = 0, effects = [], ui;
  const slots = [], requests = [], writes = [];
  const effect = (fn, deps) => {
    const at = cursor++, old = slots[at];
    if (!old || deps.some((value, i) => value !== old.deps[i])) effects.push(() => {
      old?.cleanup?.(); slots[at] = { deps, effect: fn, cleanup: fn() };
    });
  };
  const renderComponent = runInNewContext(`${body}\nreturn { state, instruction, run, controller, stop: typeof stop === 'function' ? stop : () => controller.current?.abort() }; }\nRevise`, {
    AbortController, PASSAGE_LIMIT: 6000, revisionProblem,
    useRef(value) { return slots[cursor++] ??= { current: value }; },
    useState(value) { const at = cursor++; if (!(at in slots)) slots[at] = value; return [slots[at], value => { slots[at] = value; writes.push(value); }]; },
    useEffect: effect, useLayoutEffect: effect,
  });
  const props = { source: 'First paragraph.\n\nSecond paragraph.', range: { start: 0, end: 16 }, disabled: false,
    onRevise(request) { const d = deferred(); requests.push({ ...d, ...request }); return d.promise; } };
  function render(update = {}) { Object.assign(props, update); cursor = 0; ui = renderComponent(props); const pending = effects; effects = []; pending.forEach(fn => fn()); return ui; }
  render();
  return { requests, writes, render, props,
    run(text = 'Make it clearer') { return ui.run(text); },
    stop() { ui.stop(); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
    strictReplay() { slots.forEach(slot => { if (slot?.effect) { slot.cleanup?.(); slot.cleanup = slot.effect(); } }); },
  };
}

test('superseded revision success and live callbacks cannot replace the current proposal', async () => {
  const f = fixture(), first = f.run('Older instruction'), second = f.run('Newer instruction');
  assert.equal(f.requests[0].signal.aborted, true);
  f.requests[1].onText('Current draft'); assert.equal(f.render().state.text, 'Current draft');
  f.requests[1].resolve('Current proposal'); await second;
  f.requests[0].onText('Obsolete draft'); f.requests[0].resolve('Obsolete proposal'); await first;
  assert.equal(f.render().state.text, 'Current proposal');
  assert.equal(f.render().state.instruction, 'Newer instruction');
});

test('superseded rejection cannot erase a newer request or its proposal', async () => {
  for (const error of [new DOMException('Stopped', 'AbortError'), new Error('Old network failure')]) {
    const f = fixture(), first = f.run(), second = f.run('New instruction');
    f.requests[1].resolve('Keep this'); await second;
    f.requests[0].reject(error); await first;
    assert.equal(f.render().state.phase, 'proposal'); assert.equal(f.render().state.text, 'Keep this');
  }
});

test('passage and source changes invalidate all callbacks from the previous revision', async () => {
  for (const update of [{ range: { start: 18, end: 35 } }, { source: 'Changed content at the same offsets.' }]) {
    for (const fails of [false, true]) {
      const f = fixture(), pending = f.run(); f.render(update);
      assert.equal(f.requests[0].signal.aborted, true);
      f.requests[0].onText('Old words');
      if (fails) f.requests[0].reject(new Error('Late failure')); else f.requests[0].resolve('Old proposal');
      await pending;
      assert.equal(f.render().state.phase, 'ask'); assert.equal(f.render().state.problem, undefined);
    }
  }
});

test('Stop immediately restores the form and ignores late success, failure and live updates', async () => {
  for (const fails of [false, true]) {
    const f = fixture(), pending = f.run(); f.stop();
    assert.equal(f.requests[0].signal.aborted, true); assert.equal(f.render().state.phase, 'ask');
    f.requests[0].onText('Late words');
    if (fails) f.requests[0].reject(new Error('Late failure')); else f.requests[0].resolve('Late proposal');
    await pending; assert.equal(f.render().state.phase, 'ask');
    const retry = f.run(); f.requests[1].resolve('Fresh proposal'); await retry;
    assert.equal(f.render().state.text, 'Fresh proposal');
  }
});

test('unmount and StrictMode cleanup invalidate callbacks even if the transport ignores abort', async () => {
  for (const strict of [false, true]) for (const fails of [false, true]) {
    const f = fixture(), pending = f.run();
    if (strict) f.strictReplay(); else f.unmount();
    const before = f.writes.length;
    f.requests[0].onText('Late words');
    if (fails) f.requests[0].reject(new Error('Late failure')); else f.requests[0].resolve('Late proposal');
    await pending; assert.equal(f.writes.length, before);
    if (strict) { const retry = f.run(); f.requests[1].resolve('Fresh'); await retry; assert.equal(f.render().state.text, 'Fresh'); }
  }
});

test('current revision failures are recoverable and preserve the requested instruction', async () => {
  const f = fixture(), pending = f.run('Keep the table and math');
  f.requests[0].reject(new Error('Network failed')); await pending;
  assert.equal(f.render().state.phase, 'ask'); assert.ok(f.render().state.problem);
  assert.equal(f.render().instruction, 'Keep the table and math');
  const retry = f.run('Keep the table and math');
  const text = '# Revised\n\n| Name | Value |\n|---|---|\n| café 漢字 | $x^2$ |\n\n```js\nconst x = 1;\n```';
  f.requests[1].resolve(text); await retry;
  assert.equal(f.render().state.text, text); assert.equal(f.requests.length, 2);
});

test('blank, busy and overlong passages do not issue revision requests', async () => {
  const f = fixture(); await f.run('   '); f.render({ disabled: true }); await f.run();
  f.render({ disabled: false, source: 'a'.repeat(6001), range: { start: 0, end: 6001 } }); await f.run();
  assert.equal(f.requests.length, 0);
});

function documentFixture(work) {
  let cursor = 0, effects = [], timerId = 0;
  const slots = [], timers = new Map(), listeners = new Map();
  const span = { nodeType: 1, dataset: { src: '0:16' }, closest() { return this; } };
  const article = { contains: node => node === span, querySelectorAll: () => [] };
  const start = source.indexOf('export function DocumentWork(');
  const component = source.slice(start, source.indexOf('\n  if (!message && !work)', start)).replace('export function', 'function');
  const renderComponent = runInNewContext(`${component}\narticle.current = fixtureArticle; return { range, editing, commit }; }\nDocumentWork`, {
    fixtureArticle: article, currentContent, addVersion, useSources: () => [],
    rangeFromSelection: () => ({ start: 0, end: 16 }),
    document: { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) },
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout(id) { timers.delete(id); },
    useRef(value) { return slots[cursor++] ??= { current: value }; },
    useState(value) { const at = cursor++; if (!(at in slots)) slots[at] = value; return [slots[at], value => { slots[at] = value; }]; },
    useEffect(fn, deps) { const at = cursor++, old = slots[at]; if (!old || deps.some((v, i) => v !== old.deps[i])) effects.push(() => { old?.cleanup?.(); slots[at] = { deps, cleanup: fn() }; }); },
  });
  const props = { message: { id: 'reply', content: 'First paragraph.\n\nSecond paragraph.' }, work, onWorkChange(value) { props.work = value; } };
  function render(update = {}) { Object.assign(props, update); cursor = 0; const ui = renderComponent(props); const pending = effects; effects = []; pending.forEach(fn => fn()); return ui; }
  render(); render();
  return { props, render, timers, scheduleSelection() { listeners.get('selectionchange')(); },
    select() { listeners.get('selectionchange')(); for (const fn of timers.values()) fn(); timers.clear(); return render(); } };
}

test('a selected passage is tied to the exact source document', () => {
  const f = documentFixture(); const ui = f.select();
  assert.equal(ui.range.source, f.props.message.content);
  f.render({ message: { ...f.props.message, content: 'A remotely changed document.' } });
  assert.equal(f.render().range, null);
});

test('version-cap rollover clears a selection even when the current index stays unchanged', () => {
  let work = null;
  for (let i = 1; i <= MAX_VERSIONS; i++) work = addVersion(work, 'Original', `Version ${i}`, 'you', '', i);
  const f = documentFixture(work); f.select();
  const revised = addVersion(work, 'Original', 'A different saved document', 'you', '', 100);
  assert.equal(revised.current, work.current);
  f.render({ work: revised }); assert.equal(f.render().range, null);
  assert.equal(revised.versions[0].content, 'Original');
});

test('a delayed selection event is cancelled when its source changes', () => {
  const f = documentFixture(); f.select();
  f.scheduleSelection(); assert.equal(f.timers.size, 1);
  f.render({ message: { ...f.props.message, content: 'New source' } });
  assert.equal(f.timers.size, 0); assert.equal(f.render().range, null);
  assert.equal(f.select().range.source, 'New source');
});

test('document icon controls retain accessible names when phone CSS hides their text', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  try {
    const { DocumentWork } = await server.ssrLoadModule('/src/components/DocumentWork.jsx');
    const html = renderToStaticMarkup(React.createElement(DocumentWork, {
      message: { id: 'reply', content: '# Saved document\n\nA passage.' },
      onWorkChange() {}, onOpen() {}, onReveal() {}, canRevise: true,
    }));
    assert.match(html, /<button[^>]+aria-label="Edit document"/);
    assert.match(html, /<button[^>]+aria-label="Show reply in conversation"/);
    assert.ok(html.includes('A passage.'));
  } finally { await server.close(); }
});
