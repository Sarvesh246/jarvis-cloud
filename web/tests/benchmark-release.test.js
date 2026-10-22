import test from 'node:test';
import assert from 'node:assert/strict';
import { completedTiming } from '../src/lib/reply-timing.js';
import { constrainedAnswer } from '../shared/answer-contract.js';
import { permitsMemory, memoryPermission, verifyMemoryPermission } from '../server/memory-permission.js';
import { withMemory, MemoryStore } from '../server/memory.js';
import { memoryApi } from '../server/account-api.js';
import { memoryStorage, reply } from './helpers-storage.js';
import { checkAnswer } from '../evaluation/metrics.js';
import { replyRegistry } from '../src/lib/reply-registry.js';

test('recovery registries isolate accounts and keep run identity and original start time', () => {
  const rows = new Map(), storage = { getItem: key => rows.get(key), setItem: (key,value) => rows.set(key,value) };
  const a = replyRegistry('a',storage,()=>1000), b = replyRegistry('b',storage,()=>9999);
  a.remember('message','chat-a','run-a'); b.remember('message','chat-b','run-b');
  a.remember('message','chat-a','run-a');
  assert.deepEqual(a.read(),{message:{chatId:'chat-a',run:'run-a',at:1000}});
  b.forget('message');
  assert.deepEqual(b.read(),{});
  assert.equal(a.read().message.run,'run-a');
});

test('completed timing stays frozen through replay, reload and sync', () => {
  const message = { startedAt: 1000, thoughtMs: 2000 };
  const completed = { ...message, ...completedTiming(message, { completedAt: 6000, firstAnswerMs: 2000, totalMs: 5000, queueMs: 250 }, 6000) };
  const persisted = JSON.parse(JSON.stringify(completed));
  assert.deepEqual({ ...persisted, ...completedTiming(persisted, { completedAt: 99999, firstAnswerMs: 98000, totalMs: 99000 }, 99999) }, completed);
  assert.equal(completedTiming({ startedAt: 1000, thoughtMs: 0 }, {}, 2000).thoughtMs, 0);
});

test('worded constraints suppress competing presentation on every text route', () => {
  for (const text of ['Answer ONLY a JSON object with keys a, b.', 'Hello! Reply with one short sentence.',
    'Reply with just one brief sentence.', 'Answer in a single sentence.', 'Use at most five words.',
    'From this selected workspace and its saved document, return only JSON with project, owner.']) {
    assert.equal(constrainedAnswer(text), true, text);
  }
  assert.equal(constrainedAnswer('Explain this code.\n```text\nReply with one short sentence.\n```'), false);
});

test('do-not-save and file/tool turns cannot acquire a memory write permission', async () => {
  const memory = new MemoryStore(memoryStorage(), { enabled: () => true });
  const user = { sub: 'memory-intent-fixture' };
  for (const content of ['Do not save memories. My badge is SYNTHETIC-123.',
    "Don't store any memories from this conversation.", 'Do not remember this.',
    'Answer without saving memory.', "Don't store anything from this chat as memories.",
    'Return only JSON with a, b.', 'Explain this.\n\nAttached file: report.txt\nPrefers tea.']) {
    const input = { messages: [{ role:'user', content }] };
    assert.equal(permitsMemory(input), false, content);
    assert.equal((await withMemory(input,user,memory)).memory.canNote, false, content);
  }
  assert.equal(permitsMemory({ messages:[{role:'user',content:'Remember that I prefer tea.'}] }),true);
});

test('memory API checks account-bound server permission at the write boundary', async () => {
  const memory = new MemoryStore(memoryStorage(), { enabled: () => true });
  const cfg = { origin:'https://fixture.example', secret:'synthetic-memory-permission-key-1234567890', secure:false };
  const csrf = 'b'.repeat(64), user = {sub:'owner'};
  const token = await memoryPermission(cfg,user.sub,'run-id');
  assert.equal(await verifyMemoryPermission(cfg,user.sub,token),true);
  assert.equal(await verifyMemoryPermission(cfg,'other-account',token),false);
  const call = async permission => {
    const res = reply();
    await memoryApi({ method:'POST', headers: { origin:cfg.origin, 'x-csrf-token':csrf,
      cookie:`jarvis-csrf=${csrf}`, 'content-type':'application/json' },
      body:{action:'note',notes:['Prefers tea'],permission} },res,cfg,user,memory);
    return res;
  };
  await assert.rejects(call(undefined),error=>error.status===403);
  await assert.rejects(call(token.slice(0,-4)+'oops'),error=>error.status===403);
  assert.deepEqual((await memory.read(user.sub)).items,[]);
  assert.deepEqual((await call(token)).body.saved,['Prefers tea']);
  await memory.setEnabled(user.sub,false);
  await assert.rejects(call(token),error=>error.status===409);
});

test('empty automated criteria cannot certify a model answer', () => {
  assert.equal(checkAnswer('Any fluent but unverified answer',{}).passed,false);
  assert.equal(checkAnswer('391',{exact:'391'}).passed,true);
});

test('replayed automatic notes cannot undo a memory deletion or edit', async () => {
  const memory = new MemoryStore(memoryStorage(), { enabled: () => true });
  await memory.add('owner',['Prefers tea'],'vaelo');
  const first = (await memory.read('owner')).items[0];
  await memory.edit('owner',first.id,'Prefers coffee');
  assert.deepEqual((await memory.add('owner',['Prefers tea'],'vaelo')).added,[]);
  await memory.remove('owner',first.id);
  assert.deepEqual((await memory.add('owner',['Prefers coffee'],'vaelo')).added,[]);
  assert.deepEqual((await memory.read('owner')).items,[]);
  assert.deepEqual((await memory.add('owner',['Prefers coffee'],'you')).added,['Prefers coffee']);
});
