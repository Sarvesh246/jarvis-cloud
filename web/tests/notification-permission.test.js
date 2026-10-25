import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const settings = readFileSync(new URL('../src/components/Settings.jsx', import.meta.url), 'utf8');
const source = settings.slice(settings.indexOf('function useNotify('), settings.indexOf('/* The location switch:'));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};

// Run the actual Settings hook; permission completion and passive cleanup are
// controlled independently so render-to-cleanup races remain reproducible.
function fixture({ desktop = false } = {}) {
  const slots = [], requests = [], writes = [];
  let cursor = 0, pending = [], ui, open = true, owner = 'alice', notify = false;
  let change = patch => { writes.push(patch.notify); notify = patch.notify; };
  const changed = (old, deps) => !old || deps.some((value, i) => value !== old.deps[i]);
  const hook = runInNewContext(`${source}\nuseNotify`, {
    useRef(value) { return slots[cursor++] ??= { current: value }; },
    useState(value) {
      const at = cursor++;
      if (!(at in slots)) slots[at] = value;
      return [slots[at], value => { slots[at] = value; }];
    },
    useMemo(fn, deps) {
      const at = cursor++;
      if (changed(slots[at], deps)) slots[at] = { deps, value: fn() };
      return slots[at].value;
    },
    useEffect(effect, deps) {
      const at = cursor++, old = slots[at];
      if (changed(old, deps)) pending.push(() => { old?.cleanup?.(); slots[at] = { deps, effect, cleanup: effect() }; });
    },
    allowNotifications() { const request = deferred(); requests.push(request); return request.promise; },
    notifySupport: () => 'available', DESKTOP: desktop,
  });
  function render(options = {}) {
    if (Object.hasOwn(options, 'open')) open = options.open;
    if (Object.hasOwn(options, 'owner')) owner = options.owner;
    if (Object.hasOwn(options, 'change')) change = options.change;
    cursor = 0;
    ui = hook({ notify }, change, { open, owner });
    if (options.effects !== false) commit();
    return ui;
  }
  function commit() { const work = pending; pending = []; work.forEach(fn => fn()); }
  render();
  return { render, commit, requests, writes,
    toggle(value) { return ui.toggle(value); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
    strictReplay() { slots.forEach(slot => { if (slot?.effect) { slot.cleanup?.(); slot.cleanup = slot.effect(); } }); },
  };
}

test('a late permission grant cannot undo a newer notification opt-out', async () => {
  const f = fixture();
  const first = f.toggle(true), second = f.toggle(true);
  f.requests[1].resolve(true); await second; f.render();
  await f.toggle(false); f.render();
  f.requests[0].resolve(true); await first;
  assert.deepEqual(f.writes, [true, false]);
  assert.equal(f.render().problem, '');
});

test('only the latest permission attempt may enable notifications or report an error', async () => {
  for (const late of ['grant', 'deny', 'reject']) {
    const f = fixture();
    const first = f.toggle(true), second = f.toggle(true);
    f.requests[1].resolve(true); await second;
    if (late === 'reject') f.requests[0].reject(new Error('Permission service closed'));
    else f.requests[0].resolve(late === 'grant');
    await first;
    assert.deepEqual(f.writes, [true], late);
    assert.equal(f.render().problem, '', late);
  }
});

test('a stale toggle handler cannot invalidate a new panel request or alter its preference', async () => {
  const f = fixture(), old = f.render();
  f.render({ open: false });
  f.render({ open: true });
  const current = f.toggle(true);
  const staleOff = old.toggle(false), staleOn = old.toggle(true);
  assert.equal(f.requests.length, 1);
  assert.deepEqual(f.writes, []);
  await Promise.all([staleOff, staleOn]);
  f.requests[0].resolve(true); await current;
  assert.deepEqual(f.writes, [true]);
});

test('closing and reopening Settings revokes pending grants before passive cleanup', async () => {
  for (const result of [true, false, new Error('Closed')]) {
    const f = fixture(), task = f.toggle(true);
    f.render({ open: false, effects: false });
    f.render({ open: true, effects: false });
    if (result instanceof Error) f.requests[0].reject(result);
    else f.requests[0].resolve(result);
    await task;
    assert.deepEqual(f.writes, []);
    assert.equal(f.render().problem, '');
  }
});

test('account changes revoke old permission results even after returning to the same account', async () => {
  for (const owner of ['bob', undefined]) {
    const f = fixture(), task = f.toggle(true);
    f.render({ owner, effects: false });
    f.render({ owner: 'alice', effects: false });
    f.requests[0].resolve(true); await task;
    assert.deepEqual(f.writes, []);
  }
});

test('unmount and StrictMode cleanup revoke requests while a fresh mounted attempt works', async () => {
  for (const cleanup of ['unmount', 'strictReplay']) {
    const f = fixture(), task = f.toggle(true);
    f[cleanup]();
    f.requests[0].resolve(true); await task;
    assert.deepEqual(f.writes, []);
    if (cleanup === 'strictReplay') {
      const fresh = f.toggle(true);
      f.requests[1].resolve(true); await fresh;
      assert.deepEqual(f.writes, [true]);
    }
  }
});

test('same-scope rerenders use the current preference callback without losing the request', async () => {
  const f = fixture(), task = f.toggle(true), current = [];
  f.render({ change: patch => current.push(patch.notify) });
  f.requests[0].resolve(true); await task;
  assert.deepEqual(f.writes, []);
  assert.deepEqual(current, [true]);
});

test('hidden Settings cannot start permission requests or change preferences', async () => {
  const f = fixture(); f.render({ open: false });
  const on = f.toggle(true), off = f.toggle(false);
  assert.equal(f.requests.length, 0);
  assert.deepEqual(f.writes, []);
  await Promise.all([on, off]);
});

test('current permission denial and failure retain existing messages and recover on retry', async () => {
  for (const desktop of [true, false]) {
    const f = fixture({ desktop });
    const denied = f.toggle(true); f.requests[0].resolve(false); await denied;
    assert.equal(f.render().problem, desktop
      ? 'Allow notifications for Vaelo in your system settings.'
      : 'Notifications are blocked for Vaelo. Allow them in your browser’s settings.');
    const failed = f.toggle(true); f.requests[1].reject(new Error('Unsupported')); await failed;
    assert.equal(f.render().problem, 'This browser can’t show notifications.');
    const retry = f.toggle(true); f.requests[2].resolve(true); await retry;
    assert.equal(f.render().problem, '');
    assert.deepEqual(f.writes, [true]);
    await f.toggle(false);
    assert.deepEqual(f.writes, [true, false]);
    assert.equal(f.requests.length, 3);
  }
});
