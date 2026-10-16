import test from 'node:test';
import assert from 'node:assert/strict';
import { Revocations } from '../server/revocation.js';
import { PreconditionFailedError } from '../server/kv-storage.js';

function storage() {
  const rows = new Map(); let serial = 0;
  return {
    async get(path) {
      const row = rows.get(path);
      return row ? { stream: new Response(row.text).body, blob: { etag: row.etag } } : null;
    },
    async put(path, text, options) {
      const row = rows.get(path);
      if ((options.ifMatch && row?.etag !== options.ifMatch) || (!options.allowOverwrite && row))
        throw new PreconditionFailedError();
      rows.set(path, { text, etag: String(++serial) });
    },
  };
}

for (const existing of [false, true]) test(`an older sign-out cannot undo a newer sign-out (${existing ? 'existing row' : 'first sign-out'})`, async () => {
  const store = storage();
  if (existing) await new Revocations(store, { enabled: () => true, now: () => 50_000 }).revoke('owner', 'jarvis-web');
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const waiting = new Promise(resolve => { entered = resolve; });
  const original = store.put;
  let delayed = false;
  store.put = async (path, text, options) => {
    if (JSON.parse(text).epoch === 100 && !delayed) {
      delayed = true; entered(); await gate;
    }
    return original(path, text, options);
  };
  const earlier = new Revocations(store, { enabled: () => true, now: () => 100_000 });
  const later = new Revocations(store, { enabled: () => true, now: () => 200_000 });
  const pending = earlier.revoke('owner', 'jarvis-web');
  await waiting;
  await later.revoke('owner', 'jarvis-web');
  release(); await pending;
  const fresh = new Revocations(store, { enabled: () => true });
  assert.equal(await fresh.epoch('owner', 'jarvis-web'), 200);
  assert.equal(await earlier.epoch('owner', 'jarvis-web'), 200);
  assert.equal(await fresh.epoch('owner', 'vaelo-desktop'), 0);
});

test('unreadable revocation records and persistent write conflicts fail closed', async () => {
  for (const epoch of [null, '200', -1, {}]) {
    const invalid = new Revocations({
      async get() { return { stream: new Response(JSON.stringify({ epoch })).body }; },
      async put() { assert.fail('must never overwrite an unreadable security record'); },
    }, { enabled: () => true });
    await assert.rejects(invalid.epoch('owner', 'jarvis-web'), /Invalid session revocation/);
    await assert.rejects(invalid.revoke('owner', 'jarvis-web'), /Invalid session revocation/);
  }
  let writes = 0;
  const conflict = new Revocations({
    async get() { return null; },
    async put() { writes++; throw new PreconditionFailedError(); },
  }, { enabled: () => true });
  await assert.rejects(conflict.revoke('owner', 'jarvis-web'), /changed repeatedly/);
  assert.equal(writes, 5);
});

test('an in-flight read cannot repopulate the local cache with a revoked epoch', async () => {
  const store = storage();
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const waiting = new Promise(resolve => { entered = resolve; });
  const original = store.get;
  let reads = 0;
  store.get = async path => {
    const result = await original(path);
    if (++reads === 1) { entered(); await gate; }
    return result;
  };
  const epochs = new Revocations(store, { enabled: () => true, now: () => 200_000 });
  const pending = epochs.epoch('owner', 'jarvis-web');
  await waiting;
  await epochs.revoke('owner', 'jarvis-web');
  release();
  assert.equal(await pending, 200);
  assert.equal(await epochs.epoch('owner', 'jarvis-web'), 200);
});
