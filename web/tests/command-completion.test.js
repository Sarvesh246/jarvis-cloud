import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createComposerDraft } from '../src/lib/composer-draft.js';
import { SLASH_COMMANDS, promptForCommand } from '../src/lib/slash-commands.js';

const source = readFileSync(new URL('../src/lib/use-slash-commands.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace('export function', 'function');
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
const answer = 'Café 日本語 👋\n\n$x^2$\n\n```js\nanswer()\n```';
const shortcut = { shortcuts: [{ name: 'private', prompt: answer }] };

function fixture() {
  const slots = [], requests = [], copies = [], downloads = [], toasts = [], sends = [];
  const draftStore = createComposerDraft(), writing = { current: { chatId: 'a' } }, listeners = new Set();
  const subscribe = draftStore.subscribe;
  draftStore.subscribe = callback => {
    listeners.add(callback);
    const unsubscribe = subscribe(callback);
    return () => { listeners.delete(callback); unsubscribe(); };
  };
  let cursor = 0, pending = [], ui, owner = 'alice', chatId = 'a', guest = false, offline = false;
  let toast = value => toasts.push(value.text);
  const changed = (old, deps) => !old || deps.some((value, i) => value !== old.deps[i]);
  const hook = runInNewContext(`${source}\nuseSlashCommands`, {
    useRef(value) { return slots[cursor++] ??= { current: value }; },
    useState(value) { const at = cursor++; if (!(at in slots)) slots[at] = value; return [slots[at], value => { slots[at] = value; }]; },
    useMemo(fn, deps) { const at = cursor++; if (changed(slots[at], deps)) slots[at] = { deps, value: fn() }; return slots[at].value; },
    useEffect(effect, deps) { const at = cursor++, old = slots[at]; if (changed(old, deps)) pending.push(() => { old?.cleanup?.(); slots[at] = { deps, effect, cleanup: effect() }; }); },
    SLASH_COMMANDS, promptForCommand, navigator: { onLine: false },
    setInterval() {}, clearInterval() {}, addEventListener() {}, removeEventListener() {},
    requestAnimationFrame() {}, transcriptOf: chat => chat.messages[0].content,
    copyText(text) { const d = deferred(); copies.push({ ...d, text }); return d.promise; },
    download(...args) { const d = deferred(); downloads.push({ ...d, args }); return d.promise; },
  });
  function render(options = {}) {
    if (Object.hasOwn(options, 'owner')) owner = options.owner;
    if (Object.hasOwn(options, 'chatId')) { chatId = options.chatId; writing.current = { chatId }; }
    if (Object.hasOwn(options, 'guest')) guest = options.guest;
    if (Object.hasOwn(options, 'offline')) offline = options.offline;
    if (options.toast) toast = options.toast;
    cursor = 0;
    ui = hook({ session: owner ? { user: { sub: owner, guest }, offline } : null,
      chat: { id: chatId, title: 'Test conversation', messages: [{ role: 'assistant', content: answer }] },
      chats: [], setChats() {}, setDraft: draftStore.set, draftStore, writing, textarea: { current: null }, online: true,
      request(path) { const d = deferred(); requests.push({ ...d, path }); return d.promise; },
      showToast: toast, send(value) { const d = deferred(); sends.push({ ...d, value }); return d.promise; },
    });
    if (options.effects !== false) commit();
    return ui;
  }
  function commit() { const work = pending; pending = []; work.forEach(fn => fn()); }
  render();
  return { render, commit, draftStore, writing, requests, copies, downloads, toasts, sends, listeners,
    run(name = 'shortcuts', args = 'private') { return ui.run({ name, args }); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
    strictReplay() { slots.forEach(slot => { if (slot?.effect) { slot.cleanup?.(); slot.cleanup = slot.effect(); } }); },
  };
}

test('delayed shortcuts cannot insert a private prompt after account or conversation changes', async () => {
  for (const change of [{ chatId: 'b' }, { owner: 'bob' }, { owner: null }, { guest: true }, { offline: true }]) {
    const f = fixture(), task = f.run();
    f.render({ ...change, effects: false });
    f.draftStore.set('Destination draft');
    f.requests[0].resolve(shortcut); await task;
    assert.equal(f.draftStore.getSnapshot(), 'Destination draft');
    assert.deepEqual(f.toasts, []); f.commit(); f.unmount();
  }
});

test('draft edits revoke a pending shortcut even when text returns to its original value', async () => {
  for (const roundTrip of [false, true]) {
    const f = fixture(); f.draftStore.set('/shortcuts private'); const task = f.run();
    f.draftStore.set('New words');
    if (roundTrip) f.draftStore.set('/shortcuts private');
    const kept = f.draftStore.getSnapshot();
    f.requests[0].resolve(shortcut); await task;
    assert.equal(f.draftStore.getSnapshot(), kept); f.unmount();
  }
});

test('copy and export completion preserve newer text while ordinary completion still clears the command', async () => {
  for (const name of ['copy', 'export']) for (const edit of [false, true]) {
    const f = fixture(); f.draftStore.set(`/${name}`);
    const task = f.run(name, name === 'copy' ? 'last' : 'md');
    if (edit) f.draftStore.set('A new request 👋');
    (name === 'copy' ? f.copies : f.downloads)[0].resolve(true); await task;
    assert.equal(f.draftStore.getSnapshot(), edit ? 'A new request 👋' : '');
    if (name === 'copy') { assert.equal(f.copies[0].text, answer); assert.deepEqual(f.toasts, ['Copied.']); }
    else assert.match(f.downloads[0].args[1], /Café 日本語/);
    f.unmount();
  }
});

test('stale command errors and clipboard notifications do not surface in a different scope', async () => {
  for (const name of ['shortcuts', 'copy', 'export']) for (const reject of [false, true]) {
    const f = fixture(), task = f.run(name, name === 'copy' ? 'last' : name === 'export' ? 'json' : 'private');
    f.render({ chatId: 'b' }); f.draftStore.set('Keep');
    const operation = (name === 'shortcuts' ? f.requests : name === 'copy' ? f.copies : f.downloads)[0];
    if (reject) operation.reject(Error('Old operation failed')); else operation.resolve(name === 'shortcuts' ? { shortcuts: [] } : false);
    await task;
    assert.equal(f.draftStore.getSnapshot(), 'Keep'); assert.deepEqual(f.toasts, []); f.unmount();
  }
});

test('returning to an account or conversation does not revive an earlier command', async () => {
  for (const field of ['owner', 'chatId']) {
    const f = fixture(), task = f.run();
    f.render({ [field]: field === 'owner' ? 'bob' : 'b' });
    f.render({ [field]: field === 'owner' ? 'alice' : 'a' });
    f.requests[0].resolve(shortcut); await task;
    assert.equal(f.draftStore.getSnapshot(), ''); f.unmount();
  }
});

test('conversation ownership is checked before React paints a navigation change', async () => {
  const f = fixture(), old = f.render(), task = f.run();
  f.writing.current = { chatId: 'b' };
  f.requests[0].resolve(shortcut); await task;
  assert.equal(f.draftStore.getSnapshot(), '');
  await old.run({ name: 'shortcuts', args: 'private' });
  assert.equal(f.requests.length, 1); f.unmount();
});

test('new scopes can run commands without old finally blocks unlocking their current operation', async () => {
  const f = fixture(), old = f.render(), first = f.run();
  f.render({ chatId: 'b' }); const second = f.run();
  assert.equal(f.requests.length, 2);
  await old.run({ name: 'shortcuts', args: 'private' });
  assert.equal(f.requests.length, 2);
  f.requests[0].resolve(shortcut); await first;
  await f.run(); assert.equal(f.requests.length, 2, 'current command still serializes duplicates');
  f.requests[1].resolve(shortcut); await second;
  assert.equal(f.draftStore.getSnapshot(), answer); f.unmount();
});

test('unmount and StrictMode cleanup revoke pending completion and permit a fresh attempt', async () => {
  for (const cleanup of ['unmount', 'strictReplay']) {
    const f = fixture(), task = f.run(); f[cleanup]();
    f.requests[0].resolve(shortcut); await task;
    assert.equal(f.draftStore.getSnapshot(), '');
    if (cleanup === 'strictReplay') {
      const fresh = f.run(); f.requests[1].resolve(shortcut); await fresh;
      assert.equal(f.draftStore.getSnapshot(), answer);
    }
    f.unmount();
  }
});

test('ordinary commands preserve literal shortcut text and retry after current errors', async () => {
  const f = fixture(); let task = f.run();
  f.requests[0].reject(Error('Offline')); await task;
  assert.deepEqual(f.toasts, ['Offline']);
  task = f.run(); f.render(); f.requests[1].resolve(shortcut); await task;
  assert.equal(f.draftStore.getSnapshot(), answer);
  task = f.run('export', 'json'); f.downloads[0].resolve(false); await task;
  assert.equal(f.toasts.at(-1), 'Export was cancelled.'); f.unmount();
});

test('draft subscriptions are released on success, rejection, scope cleanup and unmount', async () => {
  for (const ending of ['success', 'reject', 'scope', 'unmount']) {
    const f = fixture(), task = f.run(); assert.equal(f.listeners.size, 1);
    if (ending === 'scope') f.render({ chatId: 'b' });
    if (ending === 'unmount') f.unmount();
    if (['scope', 'unmount'].includes(ending)) assert.equal(f.listeners.size, 0);
    if (ending === 'reject') f.requests[0].reject(Error('Failed'));
    else f.requests[0].resolve(shortcut);
    await task; assert.equal(f.listeners.size, 0); f.unmount();
  }
});

test('a new command before passive cleanup cannot strand the previous scope subscription', async () => {
  const f = fixture(), first = f.run();
  f.render({ chatId: 'b', effects: false }); const second = f.run();
  assert.equal(f.listeners.size, 2);
  f.commit(); assert.equal(f.listeners.size, 1, 'old subscription released even while its request remains pending');
  f.unmount(); assert.equal(f.listeners.size, 0);
  f.requests[0].resolve(shortcut); f.requests[1].resolve(shortcut);
  await Promise.all([first, second]);
  assert.equal(f.draftStore.getSnapshot(), '');
});

test('current callbacks receive completion after a same-scope rerender', async () => {
  const f = fixture(), current = [], task = f.run('copy', 'last');
  f.render({ toast: value => current.push(value.text) });
  f.copies[0].resolve(); await task;
  assert.deepEqual(current, ['Copied.']); assert.deepEqual(f.toasts, []); f.unmount();
});

test('AI command start errors remain visible only in their originating scope', async () => {
  for (const change of ['same', 'chat', 'unmount', 'strictReplay']) {
    const f = fixture(); await f.run('explain', 'A topic');
    assert.equal(f.sends.length, 1);
    assert.equal(f.sends[0].value.slashCommand, 'explain');
    assert.match(f.sends[0].value.text, /A topic/);
    if (change === 'chat') f.render({ chatId: 'b' });
    if (['unmount', 'strictReplay'].includes(change)) f[change]();
    f.sends[0].reject(Error('Could not start')); await new Promise(setImmediate);
    assert.deepEqual(f.toasts, change === 'same' ? ['Could not start'] : []); f.unmount();
  }
});
