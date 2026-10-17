import test from 'node:test';
import assert from 'node:assert/strict';
import { readEvents } from '../src/stream.js';
import { requestRevision } from '../src/lib/revise.js';
import { collectSources } from '../src/lib/sources.js';
import { parseFences, parseTables, withoutCode, docTitle } from '../src/lib/library.js';
import { fenceClosed } from '../src/lib/structured.js';
import { toDate, toNumber, sortRows, toTSV } from '../src/lib/table.js';
import { classifyError } from '../src/lib/errors.js';

const frame = (data, event = 'message') => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const content = (text, finish_reason = null) => ({ choices: [{ delta: { content: text }, finish_reason }] });
const complete = frame({ ok: true }, 'jarvis.complete');

test('unreadable events are not acknowledged or silently accepted as complete', async () => {
  const seen = [];
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('id: 0\ndata: {"text":"start"}\n\nid: 1\ndata: broken\n\nid: 2\nevent: jarvis.complete\ndata: {"ok":true}\n\n'));
    },
    cancel() { cancelled = true; },
  });
  await assert.rejects(readEvents(body, (name, data, id) => seen.push(id)), /unreadable event/);
  assert.deepEqual(seen, ['0']);
  assert.equal(cancelled, true, 'a failed consumer releases the transport');
  for (const data of ['null', '42', '[]']) {
    await assert.rejects(readEvents(new Response(`data: ${data}\n\n`).body, () => {}), /invalid event/);
  }
});

test('SSE line endings work even when every CRLF is split between chunks', async () => {
  for (const separator of ['\n', '\r\n', '\r']) {
    const bytes = new TextEncoder().encode(`id: 3${separator}data: {"text":"café"}${separator}${separator}`);
    const body = new ReadableStream({ start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    } });
    const seen = [];
    await readEvents(body, (name, data, id) => seen.push([data, id]));
    assert.deepEqual(seen, [[{ text: 'café' }, '3']]);
  }
});

test('unfinished and oversized stream frames cannot masquerade as completed output', async () => {
  await assert.rejects(readEvents(new Response(': keepalive\ndata: {"text":"cut off"}').body, () => {}), /unexpectedly/);
  await assert.rejects(readEvents(new Response(`data: ${'x'.repeat(1024 * 1024 + 1)}`).body, () => {}), /exceeded/);
  await readEvents(new Response(': keepalive').body, () => assert.fail('a comment is not an event'));
});

test('revisions discard a looping draft and stitch a recovered continuation only once', async () => {
  const original = globalThis.fetch;
  const updates = [];
  globalThis.fetch = async () => new Response(
    frame(content('Discarded looping words.')) + frame({}, 'jarvis.retry') +
    frame(content('First section ends with', 'length')) + frame({}, 'jarvis.continue') +
    frame(content('ends with this conclusion.', 'stop')) + complete,
  );
  try {
    const result = await requestRevision({ source: 'old', start: 0, end: 3, instruction: 'revise', onText: text => updates.push(text) });
    assert.equal(result, 'First section ends with this conclusion.');
    assert.ok(updates.includes(''), 'discarded draft is cleared from the live editor');
    assert.ok(!result.includes('Discarded'));
  } finally { globalThis.fetch = original; }
});

test('an incomplete revision never becomes a saved rewrite', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(frame(content('Partial rewrite.', 'length')));
  try {
    await assert.rejects(requestRevision({ source: 'old', start: 0, end: 3, instruction: 'revise' }), /didn’t send a revision/);
  } finally { globalThis.fetch = original; }
});

test('nested and tilde code fences stay code across sources, library and completion checks', () => {
  const code = '````markdown\n```js\n# Example\nhttps://example.com/code\n```\n| A | B |\n|---|---|\n| 1 | 2 |\n````\n';
  const tilde = '~~~text\nhttps://example.com/tilde\n| A | B |\n|---|---|\n| 3 | 4 |\n~~~\n';
  const outside = '[Real source](https://example.com/real)\n\n| Name | Value |\n|---|---|\n| Real | 5 |';
  const text = code + tilde + outside;
  assert.deepEqual(collectSources(text).map(source => source.url), ['https://example.com/real']);
  assert.deepEqual(parseTables(text), [{ columns: ['Name', 'Value'], rows: [['Real', '5']] }]);
  assert.equal(parseFences(text).length, 2);
  assert.ok(parseFences(text)[0].source.includes('```js\n# Example'));
  assert.ok(!withoutCode(text).includes('Example'));
  assert.notEqual(docTitle(tilde + 'A real title'), 'text');
  const unfinished = '```metrics\nRevenue: $1\n```not-a-closing-fence';
  assert.equal(fenceClosed(unfinished, 0, unfinished.length), false);
  assert.deepEqual(parseFences(unfinished), []);
  assert.deepEqual(collectSources('``https://example.com/inline `literal` `` [Real](https://example.com/real)').map(source => source.url), ['https://example.com/real']);
});

test('saved table extraction preserves literal operators and identifiers', () => {
  const text = '| Name | Expression |\n|---|---|\n| user_name | 5 * 3 |\n| **bold** | `a_b` |\n| escaped \\| pipe | 2 |';
  assert.deepEqual(parseTables(text)[0].rows, [['user_name', '5 * 3'], ['bold', 'a_b'], ['escaped | pipe', '2']]);
  assert.deepEqual(parseTables('| Name | Value |\n|---|---|\n| slash \\\\| 3 |')[0].rows, [['slash \\\\', '3']]);
});

test('date sorting respects offsets, seconds, leap days and actual calendar dates', () => {
  assert.equal(toDate('2024-03-05T14:30:45.125+05:30'), Date.UTC(2024, 2, 5, 9, 0, 45, 125));
  assert.equal(toDate('2024-02-29'), Date.UTC(2024, 1, 29));
  for (const value of ['2023-02-29', '2024-02-30', 'April 31, 2024', '2024-01-01T12:30:75Z', '2024-01-01T12:30+02:99'])
    assert.ok(Number.isNaN(toDate(value)), value);
  const rows = [['later', '2024-03-05T10:00Z'], ['earlier', '2024-03-05T14:30+05:30']];
  assert.deepEqual(sortRows(rows, 1).map(row => row[0]), ['earlier', 'later']);
  assert.ok(Number.isNaN(toNumber('9'.repeat(400))), 'overflow does not become a chart value');
});

test('spreadsheet clipboard exports neutralize formulas just like downloads', () => {
  assert.equal(toTSV(['Name', 'Value'], [['=1+1', '@cmd'], ['-5', '+2']]), "Name\tValue\n'=1+1\t'@cmd\n-5\t+2");
});

test('a rejected repetition is a fresh retry rather than a continue action', () => {
  const problem = classifyError({ code: 'repetitive_output', partial: true, message: 'The model kept repeating.' });
  assert.equal(problem.kind, 'unknown');
  assert.equal(problem.text, 'The model kept repeating.');
});
