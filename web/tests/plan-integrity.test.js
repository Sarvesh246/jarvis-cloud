import test from 'node:test';
import assert from 'node:assert/strict';
import { readPlan, mergePlan, orderPlan, planSummary, PLAN_LIMITS } from '../src/lib/plan.js';
import { readEvents } from '../src/stream.js';

const task = (id, status = 'pending') => ({ id, content: 'Task content', status });

test('malformed JSON task identifiers cannot throw or become invented task IDs', () => {
  for (const id of [{ toString: null }, {}, [], true, null]) {
    const payload = JSON.stringify({ todos: [task('before'), task(id), task('after')] });
    assert.deepEqual(readPlan(payload).items.map(item => item.id), ['before', 'after']);
  }
  for (const id of [NaN, Infinity, -Infinity])
    assert.equal(readPlan({ todos: [task(id)] }).items.length, 0);
});

test('malformed task statuses fall back without discarding usable plan rows', () => {
  for (const status of [{ toString: null }, {}, [], true, 42, null]) {
    const plan = readPlan(JSON.stringify({ todos: [task('a', status), task('b', 'completed')] }));
    assert.deepEqual(plan.items.map(item => item.status), ['pending', 'completed']);
    assert.equal(planSummary(plan.items), '1 of 2 done');
  }
});

test('invalid rows do not consume valid numeric IDs or the plan item limit', () => {
  const todos = Array.from({ length: 60 }, () => task({}));
  todos.push(task(0), task(' 0 '), task(12), task('１２'));
  const plan = readPlan({ todos });
  assert.deepEqual(plan.items.map(item => item.id), ['0', '12', '１２']);
  assert.equal(readPlan({ todos: [...todos, ...Array.from({ length: 80 }, (_, i) => task(`x${i}`))] }).items.length, PLAN_LIMITS.items);
});

test('an unversioned tool snapshot cannot erase the last accepted revision', () => {
  const first = mergePlan(null, readPlan({ revision: 8, todos: [task('a', 'completed')] }), 100);
  const progress = mergePlan(first, readPlan({ todos: [task('a', 'completed'), task('b')] }), 200);
  assert.deepEqual(progress.items.map(item => item.id), ['a', 'b']);
  assert.equal(progress.revision, 8);
  const stale = readPlan({ revision: 7, todos: [task('a')] });
  assert.equal(mergePlan(progress, stale, 300), progress);
  const newer = mergePlan(progress, readPlan({ revision: 9, todos: [task('b', 'completed')] }), 400);
  assert.equal(newer.revision, 9);
  assert.equal(newer.items[0].doneAt, 400);
});

test('repeated unversioned snapshots preserve revision protection across saved JSON', () => {
  let plan = mergePlan(null, readPlan({ revision: 5, todos: [task('a')] }), 10);
  for (let i = 0; i < 5; i++) {
    plan = JSON.parse(JSON.stringify(mergePlan(plan, readPlan({ todos: [task('a', 'completed')] }), 20 + i)));
    assert.equal(plan.revision, 5);
    assert.equal(plan.items[0].doneAt, 20);
    assert.equal(mergePlan(plan, readPlan({ revision: 4, todos: [task('a')] })), plan);
  }
});

test('a completion at timestamp zero keeps its position on replay', () => {
  const first = mergePlan(null, readPlan({ todos: [task('a', 'completed'), task('b')] }), 0);
  const updated = mergePlan(first, readPlan({ todos: [task('a', 'completed'), task('b', 'completed')] }), 100);
  assert.equal(updated.items[0].doneAt, 0);
  assert.deepEqual(orderPlan(updated.items).map(item => item.id), ['a', 'b']);
});

test('unversioned plans remain usable and reopened tasks receive a fresh completion time', () => {
  const completed = mergePlan(null, readPlan({ todos: [task('a', 'completed')] }), 10);
  assert.equal(completed.revision, undefined);
  const reopened = mergePlan(completed, readPlan({ todos: [task('a', 'in_progress')] }), 20);
  assert.equal(reopened.items[0].doneAt, undefined);
  const finished = mergePlan(reopened, readPlan({ todos: [task('a', 'completed')] }), 30);
  assert.equal(finished.items[0].doneAt, 30);
});

test('valid nested plan text, bounds, whitelist and authored ordering stay intact', () => {
  const plan = readPlan(JSON.stringify({ revision: 12, todos: [
    { ...task('parent', 'COMPLETED'), content: '  Read\n\t Unicode 雪 🪶 ', secret: 'drop' },
    { ...task('child', 'in_progress'), parent: 'parent', content: 'Code `x | y` and $x^2$' },
    { ...task(17), content: 'z'.repeat(900), parent: '17' },
  ] }));
  assert.deepEqual(plan.items[0], { id: 'parent', status: 'completed', content: 'Read Unicode 雪 🪶' });
  assert.equal(plan.items[1].content, 'Code `x | y` and $x^2$');
  assert.equal(plan.items[2].content.length, PLAN_LIMITS.chars);
  assert.equal(plan.items[2].parent, undefined);
  const merged = mergePlan(null, plan, 100);
  assert.deepEqual(orderPlan(merged.items).map(item => item.id), ['parent', 'child', '17']);
});

test('fragmented reply events survive malformed plan fields and stale revisions without losing answer bytes', async () => {
  const answer = '# Résumé 雪\n\n| x | y |\n|---|---|\n| 1 | 2 |\n\n$x^2$\n```js\nconst x = 1;\n```';
  const frames = [
    ['hermes.todo', { revision: 8, todos: [task('a', 'completed'), task({ toString: null })] }],
    ['hermes.tool.progress', { todos: [task('a', 'completed'), task('b', { toString: null })] }],
    ['hermes.todo', { revision: 7, todos: [task('a')] }],
    ['message', { choices: [{ delta: { content: answer } }] }],
    ['jarvis.complete', { ok: true }],
  ];
  const bytes = new TextEncoder().encode(frames.map(([name, data], i) =>
    `id: ${i}\nevent: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join(''));
  const body = new ReadableStream({ start(controller) {
    for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
    controller.close();
  } });
  let plan, content = '', complete = false;
  const ids = [];
  await readEvents(body, (name, data, id) => {
    ids.push(id);
    if (name === 'hermes.todo' || name === 'hermes.tool.progress' && data.todos) {
      const parsed = readPlan(data);
      if (parsed?.items.length) plan = mergePlan(plan, parsed, 100);
    }
    content += data.choices?.[0]?.delta?.content || '';
    if (name === 'jarvis.complete') complete = data.ok;
  });
  assert.equal(complete, true);
  assert.equal(content, answer);
  assert.deepEqual(ids, ['0', '1', '2', '3', '4']);
  assert.equal(plan.revision, 8);
  assert.deepEqual(plan.items.map(item => [item.id, item.status]), [['a', 'completed'], ['b', 'pending']]);
  assert.equal(body.locked, false);
});
