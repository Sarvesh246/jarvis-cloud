import test from 'node:test';
import assert from 'node:assert/strict';
import { commandDataApi, checkCommandData } from '../server/command-data.js';
import { AccountRecord } from '../server/account-record.js';
import { memoryStorage, reply } from './helpers-storage.js';
import { cookieNames } from '../server/security.js';
const cfg = { origin: 'https://vaelo.test' }, csrf = 'a'.repeat(64);
function req(body) { return { method: 'POST', body, headers: { origin: cfg.origin, cookie: `${cookieNames(cfg).csrf}=${csrf}`, 'x-csrf-token': csrf, 'content-type': 'application/json' } }; }
test('command data isolates accounts, updates shortcuts and claims each reminder occurrence once', async () => {
  const record = new AccountRecord('commands', { empty: () => ({ shortcuts: [], reminders: [] }), check: checkCommandData }, memoryStorage());
  const run = async (body, user = 'alice', now = 0) => { const res = reply(); await commandDataApi(req(body), res, cfg, { sub: user }, record, () => now); return res.body; };
  let data = await run({ action: 'shortcut-save', name: 'review', prompt: 'Review this carefully.' });
  assert.equal(data.shortcuts.length, 1);
  await run({ action: 'shortcut-save', name: 'review', prompt: 'Updated.' });
  assert.equal((await record.read('alice')).data.shortcuts[0].prompt, 'Updated.');
  assert.deepEqual((await record.read('bob')).data.shortcuts, []);
  await assert.rejects(run({ action: 'shortcut-save', name: '../private', prompt: 'no' }), /short lowercase/);
  data = await run({ action: 'reminder-add', text: 'Read', at: 10000, repeat: 'daily' });
  const item = data.reminders[0];
  await assert.rejects(run({ action: 'reminder-delivered', id: item.id, at: item.at }, 'alice', 5000), /already changed/);
  data = await run({ action: 'reminder-delivered', id: item.id, at: item.at }, 'alice', 20000);
  assert.equal(data.reminders[0].at, 86410000);
  await assert.rejects(run({ action: 'reminder-delivered', id: item.id, at: item.at }, 'alice', 20000), /already changed/);
  await assert.rejects(run({ action: 'reminder-remove', id: item.id }, 'bob', 20000).then(() => run({ action: 'reminder-delivered', id: item.id, at: item.at }, 'bob', 20000)), /already changed/);
  assert.equal((await record.read('alice')).data.reminders.length, 1);
  const bad = req({ action: 'shortcut-save', name: 'review', prompt: 'hijack' }); bad.headers.origin = 'https://evil.test';
  await assert.rejects(commandDataApi(bad, reply(), cfg, { sub: 'alice' }, record), /origin/);
});

test('competing devices claim one overdue occurrence and preserve fixed repeat intervals', async () => {
  for (const repeat of ['once', 'daily', 'weekly']) {
    const record = new AccountRecord('reminders', { empty: () => ({ shortcuts: [], reminders: [] }), check: checkCommandData }, memoryStorage());
    const run = async (body, now) => { const res = reply(); await commandDataApi(req(body), res, cfg, { sub: 'alice' }, record, () => now); return res.body; };
    const { reminders: [item] } = await run({ action: 'reminder-add', text: 'Review café notes', at: 10000, repeat }, 0);
    const now = 30 * 86400000;
    const body = { action: 'reminder-delivered', id: item.id, at: item.at };
    const results = await Promise.allSettled([run(body, now), run(body, now), run(body, now)]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    for (const result of results.filter(r => r.status === 'rejected')) assert.equal(result.reason.status, 409);
    const stored = (await record.read('alice')).data.reminders[0];
    assert.equal(stored.text, item.text);
    if (repeat === 'once') { assert.equal(stored.done, true); assert.equal(stored.at, item.at); }
    else {
      const step = (repeat === 'daily' ? 1 : 7) * 86400000;
      assert.equal(stored.done, false); assert.ok(stored.at > now); assert.ok(stored.at <= now + step);
      assert.equal((stored.at - item.at) % step, 0);
      await assert.rejects(run(body, now), /already changed/);
    }
  }
});

test('a lost claim acknowledgement retains the existing at-most-once delivery boundary', async () => {
  const record = new AccountRecord('reminders', { empty: () => ({ shortcuts: [], reminders: [] }), check: checkCommandData }, memoryStorage());
  const created = reply();
  await commandDataApi(req({ action: 'reminder-add', text: 'Review', at: 10000, repeat: 'once' }), created, cfg, { sub: 'alice' }, record, () => 0);
  const item = created.body.reminders[0], body = { action: 'reminder-delivered', id: item.id, at: item.at };
  const lost = reply(); lost.end = () => { throw Error('Connection lost after commit'); };
  await assert.rejects(commandDataApi(req(body), lost, cfg, { sub: 'alice' }, record, () => 20000), /Connection lost/);
  assert.equal((await record.read('alice')).data.reminders[0].done, true);
  await assert.rejects(commandDataApi(req(body), reply(), cfg, { sub: 'alice' }, record, () => 20000), /already changed/);
});
