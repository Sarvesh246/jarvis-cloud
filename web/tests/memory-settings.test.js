import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../src/components/SettingsDesk.jsx', import.meta.url), 'utf8');
const account = readFileSync(new URL('../src/lib/use-memory.js', import.meta.url), 'utf8').replace(/^import .*;\r?\n/, '').replace('export function', 'function');
const memory = source.slice(source.indexOf('function Memory('), source.indexOf('  if (memory.status'));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

function fixture() {
  let cursor = 0, pending = [];
  const slots = [], requests = [], writes = [];
  const hooks = {
    useRef(value) { const at = cursor++; return slots[at] ??= { current: value }; },
    useState(value) { const at = cursor++; if (!(at in slots)) slots[at] = typeof value === 'function' ? value() : value; return [slots[at], value => { slots[at] = typeof value === 'function' ? value(slots[at]) : value; writes.push(at); }]; },
    useCallback(fn, deps) { const at = cursor++, old = slots[at]; if (!old || deps.some((v, i) => v !== old.deps[i])) slots[at] = { deps, fn }; return slots[at].fn; },
    useEffect(effect, deps) { const at = cursor++, old = slots[at]; if (!old || deps.some((v, i) => v !== old.deps[i])) pending.push(() => { old?.cleanup?.(); slots[at] = { deps, cleanup: effect() }; }); },
  };
  const renderHook = runInNewContext(`${account}\n${memory}\nreturn { memory, run, draft, editing, problem, busy, setDraft, setEditing }; }\nMemory`, hooks);
  function request(path, body) { const d = deferred(); requests.push({ ...d, path, body }); return d.promise; }
  function render() { cursor = 0; const value = renderHook({ request }); const effects = pending; pending = []; effects.forEach(fn => fn()); return value; }
  return { render, requests, writes, unmount() { slots.forEach(slot => slot?.cleanup?.()); } };
}

const initial = { enabled: true, items: [{ id: 'a', text: 'Likes tea', source: 'you', updated: 1 }] };
async function ready(f) { f.render(); f.requests[0].resolve(initial); await new Promise(setImmediate); return f.render(); }

test('memory mutations admit one save synchronously, before React can disable controls', async () => {
  const f = fixture(), ui = await ready(f);
  const first = ui.run({ action: 'enable', enabled: false });
  const repeated = ui.run({ action: 'enable', enabled: true });
  // Settle every incorrectly started request as well, so failure is deterministic.
  for (const req of f.requests.slice(1)) req.resolve({ ...initial, enabled: false });
  await Promise.all([first, repeated]);
  assert.equal(f.requests.length, 2);
  assert.equal(await repeated, false);
});

test('a late memory read cannot undo a successful note save', async () => {
  const f = fixture(), ui = await ready(f);
  const reading = ui.memory.load();
  const saving = ui.run({ action: 'remove', id: 'a' });
  f.requests[2].resolve({ ...initial, items: [] }); await saving;
  f.requests[1].resolve(initial); await reading;
  assert.equal(f.render().memory.data.items.length, 0);
});

test('unmounted memory saves do not clear drafts or report completion', async () => {
  for (const fails of [false, true]) {
    const f = fixture(), ui = await ready(f);
    const saving = ui.run({ action: 'add', text: 'Private note' });
    f.unmount(); const before = f.writes.length;
    if (fails) f.requests[1].reject(new Error('Old failure'));
    else f.requests[1].resolve(initial);
    assert.equal(await saving, false);
    assert.equal(f.writes.length, before);
  }
});

test('newest memory reload wins, including an obsolete read failure', async () => {
  for (const fails of [false, true]) {
    const f = fixture(), ui = await ready(f);
    const first = ui.memory.load(), second = ui.memory.load();
    const fresh = { ...initial, enabled: false };
    f.requests[2].resolve(fresh); await second;
    if (fails) f.requests[1].reject(new Error('Obsolete error'));
    else f.requests[1].resolve(initial);
    await first;
    assert.equal(f.render().memory.data.enabled, false);
    assert.equal(f.render().memory.error, '');
  }
});

test('failed memory saves retain notes and drafts and allow a successful retry', async () => {
  const f = fixture(), ui = await ready(f);
  ui.setDraft('café 漢字');
  const saving = ui.run({ action: 'add', text: 'café 漢字' });
  assert.equal(f.render().busy, true);
  assert.equal(await ui.memory.load(), false, 'loading cannot race an admitted save');
  f.requests[1].reject(new Error('Storage unavailable')); await saving;
  const failed = f.render();
  assert.equal(failed.busy, false);
  assert.equal(failed.draft, 'café 漢字');
  assert.equal(failed.memory.data.items[0].text, 'Likes tea');
  assert.equal(failed.problem, 'Storage unavailable');
  const retrying = failed.run({ action: 'add', text: failed.draft });
  assert.equal(f.render().problem, '');
  f.requests[2].resolve({ ...initial, items: [...initial.items, { id: 'b', text: failed.draft }] });
  assert.equal(await retrying, true);
  assert.equal(f.render().memory.data.items[1].text, 'café 漢字');
});

test('unmounted memory reads ignore both success and failure', async () => {
  for (const fails of [false, true]) {
    const f = fixture(); f.render(); f.unmount();
    const before = f.writes.length;
    if (fails) f.requests[0].reject(new Error('Old failure'));
    else f.requests[0].resolve(initial);
    await new Promise(setImmediate);
    assert.equal(f.writes.length, before);
    assert.equal(await f.render().run({ action: 'enable', enabled: false }), false);
    assert.equal(f.requests.length, 1);
  }
});
