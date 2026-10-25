import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { replyRegistry } from '../src/lib/reply-registry.js';

const key = 'vaelo-live-replies:owner';
const record = { chatId: 'chat', run: 'run', at: 1000 };
function storage(value) {
  const rows = new Map([[key, JSON.stringify(value)]]);
  return { rows, getItem: id => rows.get(id), setItem: (id, text) => rows.set(id, text) };
}

test('blocked localStorage access cannot throw during registry creation or use', () => {
  const context = { get localStorage() { throw new Error('Storage access denied'); } };
  const source = readFileSync(new URL('../src/lib/reply-registry.js', import.meta.url), 'utf8');
  const registry = runInNewContext(`${source.replace('export function', 'function')}\nreplyRegistry('owner')`, context);
  assert.equal(JSON.stringify(registry.read()), '{}');
  assert.doesNotThrow(() => registry.remember('answer', 'chat', 'run'));
  assert.doesNotThrow(() => registry.forget('answer'));
});

test('malformed recovery rows cannot crash the App recovery sort or hide valid replies', () => {
  const invalid = [null, false, 42, 'text', [], {}, { ...record, chatId: {} },
    { ...record, chatId: '' }, { ...record, at: null }, { ...record, at: '1000' },
    { ...record, at: -1 }, { ...record, at: 1e400 }, { chatId: 'chat', run: 'run' }];
  for (const bad of invalid) {
    const registry = replyRegistry('owner', storage({ bad, answer: record }));
    const pending = Object.entries(registry.read()).sort((a, b) => b[1].at - a[1].at);
    assert.deepEqual(pending, [['answer', record]], JSON.stringify(bad));
  }
});

test('malformed registry containers and invalid JSON remain optional recovery data', () => {
  for (const value of [null, false, 42, 'text', [], [record]]) {
    assert.deepEqual(replyRegistry('owner', storage(value)).read(), {});
  }
  const memory = storage({});
  memory.rows.set(key, '{unfinished');
  assert.deepEqual(replyRegistry('owner', memory).read(), {});
});

test('legacy recovery rows retain the message-ID run fallback and zero timestamps', () => {
  const legacy = { chatId: 'chat', at: 0 };
  const registry = replyRegistry('owner', storage({ answer: legacy }), () => 9000);
  assert.equal(registry.read().answer.run ?? 'answer', 'answer');
  registry.remember('answer', 'chat', 'answer');
  assert.equal(registry.read().answer.at, 0);
});

test('remember and forget remove malformed rows while retaining independent recovery records', () => {
  const memory = storage({ bad: null, answer: record, other: { ...record, run: 'other' } });
  const registry = replyRegistry('owner', memory, () => 2000);
  registry.remember('answer', 'chat', 'run');
  assert.deepEqual(registry.read(), { answer: record, other: { ...record, run: 'other' } });
  assert.equal(JSON.parse(memory.rows.get(key)).bad, undefined);
  registry.remember('answer', 'chat', 'replacement');
  assert.equal(registry.read().answer.at, 2000);
  registry.forget('answer');
  assert.deepEqual(registry.read(), { other: { ...record, run: 'other' } });
});

test('storage getter and operation failures can recover on a later call', () => {
  const source = readFileSync(new URL('../src/lib/reply-registry.js', import.meta.url), 'utf8');
  const memory = storage({ answer: record });
  let blocked = true;
  const context = { get localStorage() { if (blocked) throw new Error('denied'); return memory; } };
  const registry = runInNewContext(`${source.replace('export function', 'function')}\nreplyRegistry('owner')`, context);
  assert.equal(JSON.stringify(registry.read()), '{}');
  blocked = false;
  assert.equal(JSON.stringify(registry.read()), JSON.stringify({ answer: record }));
  const broken = replyRegistry('owner', { getItem() { throw new Error('read'); }, setItem() { throw new Error('write'); } });
  assert.deepEqual(broken.read(), {});
  assert.doesNotThrow(() => broken.remember('answer', 'chat', 'run'));
  assert.doesNotThrow(() => broken.forget('answer'));
});

test('special object-property IDs remain own recovery records without prototype writes', () => {
  const memory = storage({});
  const registry = replyRegistry('owner', memory, () => 1000);
  for (const id of ['__proto__', 'constructor', 'toString']) registry.remember(id, 'chat', 'run');
  assert.deepEqual(Object.keys(registry.read()).sort(), ['__proto__', 'constructor', 'toString'].sort());
  for (const id of ['__proto__', 'constructor', 'toString']) registry.forget(id);
  assert.deepEqual(registry.read(), {});
  assert.equal(Object.prototype.chatId, undefined);
});

test('account scopes and ordinary replay timestamps remain unchanged', () => {
  const memory = storage({});
  const a = replyRegistry('owner', memory, () => 1000), b = replyRegistry('other', memory, () => 5000);
  a.remember('answer', 'chat', 'run'); b.remember('answer', 'other-chat', 'other-run');
  a.remember('answer', 'chat', 'run');
  assert.deepEqual(a.read(), { answer: record });
  assert.deepEqual(b.read(), { answer: { chatId: 'other-chat', run: 'other-run', at: 5000 } });
  b.forget('answer');
  assert.deepEqual(a.read(), { answer: record });
});
