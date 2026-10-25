import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../src/lib/use-slash-commands.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace('export function', 'function');
const flush = () => new Promise(setImmediate);
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const due = (id = 'one') => ({ id, text: `Private café reminder ${id}`, at: 100, done: false, repeat: 'once' });

// Execute the production hook with controllable requests, timers and effect cleanup.
function fixture() {
  const slots = [], timers = new Map(), events = new Map(), requests = [], toasts = [], notifications = [];
  let cursor = 0, pending = [], serial = 0, ui, session = { user: { sub: 'alice' } }, notify = () => Promise.resolve();
  const changed = (old, deps) => !old || deps.some((v, i) => v !== old.deps[i]);
  const environment = {
    useRef(value) { return slots[cursor++] ??= { current: value }; },
    useState(value) { const at = cursor++; if (!(at in slots)) slots[at] = value; return [slots[at], v => { slots[at] = typeof v === 'function' ? v(slots[at]) : v; }]; },
    useMemo(fn, deps) { const at = cursor++; if (changed(slots[at], deps)) slots[at] = { deps, value: fn() }; return slots[at].value; },
    useEffect(effect, deps) { const at = cursor++, old = slots[at]; if (changed(old, deps)) pending.push(() => { old?.cleanup?.(); slots[at] = { deps, effect, cleanup: effect() }; }); },
    navigator: { onLine: true }, Date: class extends Date { static now() { return 1000; } },
    setInterval(fn) { timers.set(++serial, fn); return serial; }, clearInterval(id) { timers.delete(id); },
    addEventListener(name, fn) { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(fn); },
    removeEventListener(name, fn) { events.get(name)?.delete(fn); }, requestAnimationFrame() {},
  };
  const hook = runInNewContext(`${source}\nuseSlashCommands`, environment);
  function render({ effects = true } = {}) {
    cursor = 0;
    const owner = session?.user?.sub;
    ui = hook({ session, chats: [], textarea: { current: null }, setChats() {},
      request(path, body) { const d = deferred(); requests.push({ ...d, path, body, owner }); return d.promise; },
      showToast(value) { toasts.push({ ...value, owner }); },
      tellReady(...args) { notifications.push({ args, owner }); return notify(); },
    });
    if (effects) commit();
    return ui;
  }
  function commit() { const work = pending; pending = []; work.forEach(fn => fn()); }
  return { render, commit, requests, toasts, notifications, timers, events, navigator: environment.navigator,
    account(value, options) { session = value; return render(options); },
    close() { ui.close(); render(); },
    poll() { for (const fn of [...timers.values()]) fn(); },
    wake(name) { for (const fn of [...(events.get(name) || [])]) fn(); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
    strictReplay() { slots.forEach(slot => { if (slot?.effect) { slot.cleanup?.(); slot.cleanup = slot.effect(); } }); },
    failNotification(fn) { notify = fn; },
  };
}

test('closing a panel preserves an outstanding reminder claim and its notification', async () => {
  const f = fixture(); f.render();
  f.requests[0].resolve({ reminders: [due()] }); await flush();
  assert.equal(f.requests[1].body.action, 'reminder-delivered');
  f.close(); f.close(); f.poll(); f.wake('focus');
  assert.equal(f.requests.length, 2, 'one poll stays in flight while closing panels');
  f.requests[1].resolve({ reminders: [] }); await flush();
  assert.equal(f.toasts.length, 1); assert.equal(f.notifications.length, 1);
  f.close(); assert.equal(f.requests.length, 3, 'closing an idle panel still refreshes reminders');
  f.unmount();
});

test('guest, offline and signed-out sessions revoke pending reminder delivery', async () => {
  for (const session of [{ user: { sub: 'alice', guest: true } }, { user: { sub: 'alice' }, offline: true }, null]) {
    for (const stage of ['read', 'claim']) {
      const f = fixture(); f.render();
      if (stage === 'claim') { f.requests[0].resolve({ reminders: [due()] }); await flush(); }
      const count = f.requests.length;
      const queued = [...f.timers.values()]; f.account(session);
      f.requests.at(-1).resolve({ reminders: [due()] }); await flush(); queued.forEach(fn => fn());
      assert.equal(f.requests.length, count, `${stage}: no stale claims or polls`);
      assert.equal(f.toasts.length, 0); assert.equal(f.notifications.length, 0);
      assert.equal(f.timers.size, 0); f.unmount();
    }
  }
});

test('account changes revoke old callbacks before passive effect cleanup', async () => {
  for (const stage of ['read', 'claim']) {
    const f = fixture(); f.render();
    if (stage === 'claim') { f.requests[0].resolve({ reminders: [due()] }); await flush(); }
    const count = f.requests.length;
    f.account({ user: { sub: 'bob' } }, { effects: false });
    f.requests.at(-1).resolve({ reminders: [due()] }); await flush(); f.poll();
    assert.equal(f.requests.length, count, 'old scope cannot send with the new account request');
    assert.equal(f.toasts.length, 0); assert.equal(f.notifications.length, 0);
    f.commit(); assert.equal(f.requests.at(-1).owner, 'bob'); f.unmount();
  }
});

test('polling serializes wake events and retries failed reads and claims', async () => {
  const f = fixture(); f.render(); f.poll(); f.wake('focus'); f.wake('online');
  assert.equal(f.requests.length, 1);
  f.requests[0].reject(Error('Network failure')); await flush(); f.poll();
  f.requests[1].resolve({ reminders: [due(), due('two'), { ...due('future'), at: 2000 }, { ...due('done'), done: true }] }); await flush();
  f.requests[2].reject(Error('Claimed on another device')); await flush();
  assert.equal(f.requests[3].body.id, 'two');
  f.requests[3].resolve({ reminders: [] }); await flush();
  assert.equal(f.toasts.length, 1); assert.match(f.toasts[0].text, /two/);
  assert.equal(f.notifications.length, 1);
  f.navigator.onLine = false; f.poll(); assert.equal(f.requests.length, 4);
  f.navigator.onLine = true; f.wake('online'); assert.equal(f.requests.length, 5); f.unmount();
});

test('StrictMode and unmount invalidate obsolete reads and release wake listeners', async () => {
  const f = fixture(); f.render(); f.strictReplay();
  assert.equal(f.requests.length, 2); assert.equal(f.timers.size, 1);
  f.requests[0].resolve({ reminders: [due()] }); await flush(); assert.equal(f.requests.length, 2);
  const queued = [...f.timers.values()]; f.unmount();
  f.requests[1].resolve({ reminders: [due()] }); await flush(); queued.forEach(fn => fn());
  assert.equal(f.requests.length, 2); assert.equal(f.timers.size, 0);
  assert.equal(f.events.get('focus').size, 0); assert.equal(f.events.get('online').size, 0);
  assert.equal(f.toasts.length, 0);
});

test('a synchronous notification failure does not discard other due reminders', async () => {
  const f = fixture(); f.failNotification(() => { throw Error('Notifications unavailable'); }); f.render();
  f.requests[0].resolve({ reminders: [due(), due('two')] }); await flush();
  f.requests[1].resolve({ reminders: [] }); await flush();
  assert.equal(f.requests[2]?.body.id, 'two');
  f.requests[2].resolve({ reminders: [] }); await flush();
  assert.equal(f.toasts.length, 2); f.unmount();
});

test('rejected notification promises are contained while other reminders deliver', async () => {
  const f = fixture(); f.failNotification(() => Promise.reject(Error('Permission denied'))); f.render();
  f.requests[0].resolve({ reminders: [due(), due('two')] }); await flush();
  f.requests[1].resolve({ reminders: [] }); await flush();
  f.requests[2].resolve({ reminders: [] }); await flush();
  assert.equal(f.toasts.length, 2); assert.equal(f.notifications.length, 2); f.unmount();
});

test('returning to an account cannot revive its earlier pending poll', async () => {
  const f = fixture(); f.render();
  f.account({ user: { sub: 'bob' } }); f.account({ user: { sub: 'alice' } });
  f.requests[0].resolve({ reminders: [due('obsolete-alice')] });
  f.requests[1].resolve({ reminders: [due('obsolete-bob')] }); await flush();
  assert.equal(f.requests.length, 3);
  f.requests[2].resolve({ reminders: [due('current')] }); await flush();
  assert.equal(f.requests[3].body.id, 'current'); assert.equal(f.requests[3].owner, 'alice');
  f.requests[3].resolve({ reminders: [] }); await flush();
  assert.equal(f.toasts.length, 1); assert.match(f.toasts[0].text, /current/); f.unmount();
});
