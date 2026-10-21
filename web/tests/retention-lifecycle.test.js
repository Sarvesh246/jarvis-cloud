import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expiredChatIds, validRetention } from '../shared/retention.js';

const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const hookPath = new URL('../src/lib/use-retention.js', import.meta.url);
const hook = readFileSync(hookPath, 'utf8').replace(/^import .*;\r?\n/gm, '').replaceAll('export function', 'function');
const currentBlock = app.slice(app.indexOf('  const retentionOwner'), app.indexOf('  /* The free cloud sleeps'));
const clock = Date.UTC(2026, 9, 21);
const DAY = 86400000;
const old = id => ({ id, updated: clock - 400 * DAY, messages: [{ role: 'user', content: 'café 漢字 $x$' }] });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = () => new Promise(setImmediate);

function fixture({ settings = false } = {}) {
  let cursor = 0, effects = [], session = { user: { sub: 'a' } }, chats = [old('old')];
  const slots = [], requests = [], timers = new Map(), pushed = [], writes = [], saved = [];
  let serial = 0;
  const changed = (old, deps) => !old || deps.some((v, i) => v !== old.deps[i]);
  const hooks = {
    useRef(value) { const at = cursor++; return slots[at] ??= { current: value }; },
    useState(value) { const at = cursor++; if (!(at in slots)) slots[at] = typeof value === 'function' ? value() : value; return [slots[at], value => { slots[at] = typeof value === 'function' ? value(slots[at]) : value; writes.push(at); }]; },
    useMemo(fn, deps) { const at = cursor++; if (changed(slots[at], deps)) slots[at] = { deps, value: fn() }; return slots[at].value; },
    useCallback(fn, deps) { return hooks.useMemo(() => fn, deps); },
    useEffect(effect, deps) { const at = cursor++, previous = slots[at]; if (changed(previous, deps)) effects.push(() => { previous?.cleanup?.(); slots[at] = { deps, effect, cleanup: effect() }; }); },
  };
  const environment = {
    ...hooks, validRetention, expiredChatIds,
    Date: class extends Date { static now() { return clock; } },
    document: { hidden: false },
    setTimeout(fn) { timers.set(++serial, fn); return serial; },
    setInterval(fn) { timers.set(++serial, fn); return serial; },
    clearTimeout(id) { timers.delete(id); }, clearInterval(id) { timers.delete(id); },
  };
  const renderApp = runInNewContext(`${hook}\n(function(session, request, chatsRef, activeId, runs, startingRuns, setChats, pushChat) {
    ${settings ? 'return useRetentionSettings(request, (days, now) => saved.push({ days, now }));' : `${currentBlock}\nreturn { update: retention.update, prune };`}
  })`, environment);
  environment.saved = saved;
  const request = (path, body) => { const d = deferred(); requests.push({ ...d, path, body }); return d.promise; };
  const runs = { current: new Map() }, startingRuns = { current: new Map() };
  let activeId = 'open';
  function render() {
    cursor = 0;
    const ui = renderApp(session, request, { current: chats }, activeId, runs, startingRuns, value => { chats = value(chats); }, id => pushed.push(id));
    const pending = effects; effects = []; pending.forEach(fn => fn());
    return ui;
  }
  return {
    render, requests, pushed, timers, writes, saved, runs, startingRuns, document: environment.document,
    get chats() { return chats; }, set chats(value) { chats = value; },
    account(sub, extra = {}) { session = sub ? { user: { sub, ...extra.user }, ...extra } : null; return render(); },
    pass() { for (const fn of [...timers.values()]) fn(); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
    strictReplay() { slots.forEach(slot => { if (slot?.effect) { slot.cleanup?.(); slot.cleanup = slot.effect(); } }); },
  };
}

async function ready(f, days = 30) { f.render(); f.requests[0].resolve({ days, now: clock }); await flush(); return f.render(); }

test('retention cannot reuse another account policy during slow or failed loading', async () => {
  for (const fails of [false, true]) {
    const f = fixture(); await ready(f);
    f.account('b'); f.pass();
    assert.equal(f.chats.length, 1, 'a pending account policy cannot delete history');
    if (fails) f.requests[1].reject(new Error('Offline'));
    else f.requests[1].resolve({ days: 0, now: clock });
    await flush(); f.render(); f.pass();
    assert.equal(f.chats.length, 1); assert.equal(f.pushed.length, 0);
  }
});

test('saving Forever invalidates a delayed initial retention read', async () => {
  const f = fixture(), ui = f.render();
  ui.update(0, clock); f.render();
  f.requests[0].resolve({ days: 30, now: clock }); await flush();
  f.render(); f.pass();
  assert.equal(f.chats.length, 1); assert.equal(f.pushed.length, 0);
});

test('old Settings completion cannot install a deletion policy on another account', async () => {
  const f = fixture(), oldUI = await ready(f, 0);
  f.account('b'); f.requests[1].resolve({ days: 0, now: clock }); await flush(); f.render();
  oldUI.update(30, clock); f.render(); f.pass();
  assert.equal(f.chats.length, 1); assert.equal(f.pushed.length, 0);
});

test('sign-out, guest and offline lifetimes cannot execute queued pruning callbacks', async () => {
  for (const mode of ['signed-out', 'guest', 'offline']) {
    const f = fixture(), ui = await ready(f);
    const queued = [...f.timers.values()];
    if (mode === 'signed-out') f.account(null);
    else if (mode === 'offline') f.account('a', { offline: true });
    else f.account('a', { user: { sub: 'a', guest: true } });
    queued.forEach(fn => fn()); ui.update(30, clock); f.render(); f.pass();
    assert.equal(f.chats.length, 1, mode); assert.equal(f.pushed.length, 0, mode);
  }
});

test('out-of-order account reads and returning to an account ignore old completion callbacks', async () => {
  const f = fixture(), oldUI = f.render();
  f.account('b'); f.account('a');
  f.requests[2].resolve({ days: 0, now: clock });
  f.requests[1].resolve({ days: 30, now: clock }); f.requests[0].resolve({ days: 30, now: clock });
  await flush(); f.render(); oldUI.update(30, clock); f.render(); f.pass();
  assert.equal(f.chats.length, 1);
});

test('invalid retention responses do not activate automatic deletion', async () => {
  for (const result of [null, {}, { days: '30', now: clock }, { days: 30, now: null }, { days: 30, now: Infinity }, { days: 30, now: '99999999999999' }]) {
    const f = fixture(); f.render(); f.requests[0].resolve(result); await flush();
    f.render(); f.pass(); assert.equal(f.chats.length, 1, JSON.stringify(result));
  }
});

test('valid account policy keeps clock correction, hidden-page and protected-history behavior', async () => {
  const f = fixture();
  f.chats = [old('open'), { ...old('pinned'), pinned: true }, old('busy'), old('starting'), { ...old('running'), messages: [{ running: true }] }, ...Array.from({ length: 30 }, (_, i) => old(`old-${i}`)), { ...old('recent'), updated: clock }];
  f.runs.current.set('busy', {}); f.startingRuns.current.set('starting', {});
  const ui = await ready(f);
  f.document.hidden = true; f.pass(); assert.equal(f.pushed.length, 0);
  f.document.hidden = false;
  // Execute just the first scheduled pass, keeping the per-pass bound visible.
  [...f.timers.values()][0](); assert.equal(f.pushed.length, 25);
  assert.ok(['open', 'pinned', 'busy', 'starting', 'running', 'recent'].every(id => f.chats.some(chat => chat.id === id)));
  ui.update(30, clock + 100 * DAY); f.render(); f.pass();
  assert.ok(f.pushed.includes('recent'), 'uses the server clock rather than the device clock');
});

test('unmounted and StrictMode obsolete reads cannot revive a retention policy', async () => {
  const f = fixture(); f.render(); f.strictReplay();
  f.requests[1].resolve({ days: 0, now: clock }); f.requests[0].resolve({ days: 30, now: clock });
  await flush(); const ui = f.render(); f.pass(); assert.equal(f.chats.length, 1);
  f.unmount(); const before = f.writes.length;
  ui.update(30, clock); assert.equal(f.writes.length, before); assert.equal(f.timers.size, 0);
});

test('saving Forever and unmount invalidate already queued passes before another render', async () => {
  for (const action of ['save', 'unmount']) {
    const f = fixture(), ui = await ready(f);
    const queued = [...f.timers.values()];
    if (action === 'save') ui.update(0, clock);
    else f.unmount();
    queued.forEach(fn => fn());
    assert.equal(f.chats.length, 1, action); assert.equal(f.pushed.length, 0, action);
  }
});

test('History admits one confirmed save synchronously and invalidates its pending GET', async () => {
  const f = fixture({ settings: true }), ui = f.render();
  const saving = ui.run({ days: 0 });
  assert.equal(await ui.run({ days: 30, confirm: true }), false);
  assert.equal(await ui.load(), false);
  assert.equal(f.requests.length, 2);
  assert.deepEqual(f.requests[1].body, { days: 0 });
  assert.equal(f.render().busy, true);
  f.requests[1].resolve({ days: 0, now: clock }); assert.equal(await saving, true);
  f.requests[0].resolve({ days: 30, now: clock }); await flush();
  assert.equal(f.render().data.days, 0);
  assert.equal(f.render().busy, false);
  assert.deepEqual(f.saved.map(({ days, now }) => ({ days, now })), [{ days: 0, now: clock }]);
});

test('History retains a failed choice for retry and rejects malformed server policies', async () => {
  const f = fixture({ settings: true }); await ready(f, 0);
  const bad = f.render().run({ days: 30, confirm: true });
  f.requests[1].reject(new Error('Storage unavailable')); assert.equal(await bad, false);
  let ui = f.render(); assert.equal(ui.data.days, 0); assert.equal(ui.problem, 'Storage unavailable');
  const invalid = ui.run({ days: 30, confirm: true });
  f.requests[2].resolve({ days: 30, now: '99999999999999' }); assert.equal(await invalid, false);
  ui = f.render(); assert.equal(ui.data.days, 0); assert.equal(ui.busy, false); assert.equal(f.saved.length, 0);
  const retry = ui.run({ days: 30, confirm: true });
  f.requests[3].resolve({ days: 30, now: clock }); assert.equal(await retry, true);
  assert.equal(f.render().data.days, 30); assert.equal(f.render().problem, '');
});

test('History ignores read and save completions after unmount, including failures', async () => {
  for (const operation of ['load', 'save']) for (const fails of [false, true]) {
    const f = fixture({ settings: true }), ui = f.render();
    const pending = operation === 'save' ? ui.run({ days: 30, confirm: true }) : Promise.resolve();
    f.unmount(); const before = f.writes.length;
    for (const request of f.requests) {
      if (fails) request.reject(new Error('Obsolete failure'));
      else request.resolve({ days: 30, now: clock });
    }
    await pending; await flush();
    assert.equal(f.writes.length, before); assert.equal(f.saved.length, 0);
  }
});

test('History retry orders reads and StrictMode ignores obsolete success and failure', async () => {
  for (const fails of [false, true]) {
    const f = fixture({ settings: true }); f.render(); f.strictReplay();
    f.requests[1].resolve({ days: 0, now: clock });
    if (fails) f.requests[0].reject(new Error('Old failure'));
    else f.requests[0].resolve({ days: 30, now: clock });
    await flush(); let ui = f.render(); assert.equal(ui.data.days, 0); assert.equal(ui.error, '');
    const first = ui.load(), second = ui.load();
    f.requests[3].resolve({ days: 365, now: clock }); await second;
    f.requests[2].resolve({ days: 30, now: clock }); await first;
    assert.equal(f.render().data.days, 365);
  }
});

