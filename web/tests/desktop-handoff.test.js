import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { readDesktopHandoff, markDesktopHandoffStarted, clearDesktopHandoff } from '../src/lib/desktop-handoff.js';

const key = 'vaelo-desktop-handoff';
const home = new URL('https://vaelo.example/');
const pending = { port: 45000, state: 's'.repeat(43), challenge: 'c'.repeat(43), at: 1000 };
const link = () => new URL(`https://vaelo.example/?desktop=1&${new URLSearchParams(pending)}`);
function storage(value) {
  const entries = new Map(value === undefined ? [] : [[key, JSON.stringify(value)]]);
  return { entries, getItem: k => entries.get(k), setItem: (k, v) => entries.set(k, v), removeItem: k => entries.delete(k) };
}

test('restored desktop callbacks reject ports that could change the loopback destination', () => {
  for (const port of ['1@external.example', '45000', 443, 65536, 45000.5, null, {}, []]) {
    const memory = storage({ ...pending, port });
    assert.equal(readDesktopHandoff(memory, home, 2000), null, JSON.stringify(port));
    assert.equal(memory.entries.has(key), false);
  }
});

test('restored desktop handoffs validate proofs and record shape before authorizing', () => {
  for (const value of [true, 1, 'saved', [], {}, { ...pending, state: null },
    { ...pending, state: 's'.repeat(42) }, { ...pending, challenge: '/'.repeat(43) },
    { ...pending, challenge: ['c'.repeat(43)] }]) {
    const memory = storage(value);
    assert.equal(readDesktopHandoff(memory, home, 2000), null, JSON.stringify(value));
    assert.equal(memory.entries.has(key), false);
  }
});

test('saved handoffs cannot evade expiry with absent, coerced or future timestamps', () => {
  for (const at of [undefined, null, '1000', -1, 1000.5, 2001, {}, Number.MAX_SAFE_INTEGER + 1]) {
    const memory = storage({ ...pending, at });
    assert.equal(readDesktopHandoff(memory, home, 2000), null, JSON.stringify(at));
  }
  assert.deepEqual(readDesktopHandoff(storage(pending), home, 301000), pending);
  assert.equal(readDesktopHandoff(storage(pending), home, 301001), null);
});

test('only a boolean started marker can restore automatic approval', () => {
  for (const started of ['false', 'true', 1, [], {}, null]) {
    assert.equal(readDesktopHandoff(storage({ ...pending, started }), home, 2000), null);
  }
  for (const started of [true, false]) {
    assert.deepEqual(readDesktopHandoff(storage({ ...pending, started }), home, 2000), { ...pending, started });
  }
});

test('storage read, write and cleanup failures cannot break browser startup', () => {
  const denied = () => { throw new DOMException('Storage denied', 'SecurityError'); };
  assert.equal(readDesktopHandoff({ getItem: denied, removeItem: denied }, home, 2000), null);
  assert.equal(readDesktopHandoff({ getItem: () => '{', removeItem: denied }, home, 2000), null);
  assert.equal(readDesktopHandoff({ getItem: () => null, removeItem: denied }, home, 2000), null);
  assert.equal(readDesktopHandoff({ setItem: denied, removeItem: denied }, link(), 2000), null);
});

test('clearing a handoff contains unavailable storage so cancel and callback can proceed', () => {
  const memory = storage(pending);
  clearDesktopHandoff(memory);
  assert.equal(memory.entries.has(key), false);
  assert.doesNotThrow(() => clearDesktopHandoff({ removeItem() { throw Error('denied'); } }));
});

test('browser storage getter failures stay inside the handoff failure boundary', () => {
  const source = readFileSync(new URL('../src/lib/desktop-handoff.js', import.meta.url), 'utf8').replaceAll('export ', '');
  const environment = { URL, location: { href: home.href } };
  Object.defineProperty(environment, 'sessionStorage', { get() { throw Error('Storage denied'); } });
  const api = runInNewContext(`${source}\n({ readDesktopHandoff, clearDesktopHandoff, markDesktopHandoffStarted })`, environment);
  assert.equal(api.readDesktopHandoff(), null);
  assert.doesNotThrow(() => api.clearDesktopHandoff());
  assert.equal(api.markDesktopHandoffStarted(pending).started, true);
});

test('valid callback boundaries and redirect consent retain their existing contract', () => {
  for (const port of [1024, 45000, 65535]) {
    const memory = storage();
    const url = link(); url.searchParams.set('port', port);
    const fresh = readDesktopHandoff(memory, url, 1000);
    assert.deepEqual(fresh, { ...pending, port });
    assert.equal(new URL(`http://127.0.0.1:${fresh.port}/callback`).hostname, '127.0.0.1');
    const started = markDesktopHandoffStarted(fresh, memory);
    assert.deepEqual(started, { ...fresh, started: true });
    assert.deepEqual(readDesktopHandoff(memory, home, 2000), started);
    assert.deepEqual(readDesktopHandoff(memory, url, 3000), { ...fresh, at: 3000 });
  }
});

test('a malformed new link discards an earlier handoff instead of reusing its consent', () => {
  const memory = storage({ ...pending, started: true });
  const url = link(); url.searchParams.set('challenge', 'invalid');
  assert.equal(readDesktopHandoff(memory, url, 2000), null);
  assert.equal(readDesktopHandoff(memory, home, 2000), null);
});
