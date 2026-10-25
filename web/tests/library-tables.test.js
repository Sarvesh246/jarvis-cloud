import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { renderToStaticMarkup } from 'react-dom/server';
import { collectWork, parseTables } from '../src/lib/library.js';
import { toCSV } from '../src/lib/table.js';
import { Worker } from 'node:worker_threads';

const table = (divider = '|---|---|') => `| Name | Value |\n${divider}\n| Ana | 1 |\n| Ben | 2 |\n| Céline | 3 |`;
const expected = { columns: ['Name', 'Value'], rows: [['Ana', '1'], ['Ben', '2'], ['Céline', '3']] };
const render = source => renderToStaticMarkup(React.createElement(Markdown, {
  remarkPlugins: [remarkGfm, [remarkMath, { singleDollarTextMath: false }]], children: source,
}));

test('saved tables accept the short and aligned separators the transcript renders', () => {
  for (const divider of ['|-|-|', '|:-|-:|', '|:-:|--:|', '-- | --', ' :-- | :-: ']) {
    const source = table(divider);
    assert.match(render(source), /<table>/, divider);
    assert.deepEqual(parseTables(source), [expected], divider);
  }
});

test('mismatched delimiters and escaped header pipes remain prose', () => {
  for (const source of [table('|---|'), table('|---|---|---|'), 'Name \\| Value\n--- | ---\nAna | 1']) {
    assert.doesNotMatch(render(source), /<table>/);
    assert.deepEqual(parseTables(source), []);
  }
});

test('indented code and finished or unfinished fences never create saved tables', () => {
  for (const source of [
    table().split('\n').map(line => `    ${line}`).join('\n'),
    table().split('\n').map(line => `\t${line}`).join('\n'),
    table().split('\n').map(line => ` \t${line}`).join('\n'),
    `\`\`\`md\n${table()}\n\`\`\``,
    `~~~~md\n${table()}`,
  ]) {
    assert.doesNotMatch(render(source), /<table>/);
    assert.deepEqual(parseTables(source), []);
  }
});

test('ragged body rows retain their rendered column positions', () => {
  const source = '| Name | Value |\n|-|-|\n| Ana |\n| Ben | 2 | ignored |\n| Céline |';
  assert.deepEqual(parseTables(source), [{ columns: expected.columns, rows: [['Ana', ''], ['Ben', '2'], ['Céline', '']] }]);
  assert.match(render(source), /<td>Ana<\/td><td><\/td>/);
});

test('invalid separator syntax cannot turn following lines into saved data', () => {
  for (const divider of ['- | -', '|:|:|', '|---x|---|', '|**---**|---|', '|`---`|---|', '|---||', '    |---|---|', '|\u00a0---|---|']) {
    const source = table(divider);
    assert.doesNotMatch(render(source), /<table>/, divider);
    assert.deepEqual(parseTables(source), [], divider);
  }
});

test('large malformed separators reject promptly and a large valid separator still works', async () => {
  const worker = new Worker(`
    const {parentPort, workerData} = require('node:worker_threads');
    import(workerData).then(({parseTables}) => {
      const bad = '|---|---' + ' '.repeat(250000) + 'x';
      const valid = '|' + '-'.repeat(250000) + '|---|';
      parentPort.postMessage([bad, valid].map(divider =>
        parseTables('| A | B |' + '\\n' + divider + '\\n' + '| 1 | 2 |')));
    }).catch(error => { throw error; });
  `, { eval: true, workerData: new URL('../src/lib/library.js', import.meta.url).href });
  let timer;
  try {
    const result = await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Separator parsing exceeded three seconds.')), 3000);
      worker.once('message', resolve);
      worker.once('error', reject);
    });
    assert.deepEqual(result, [[], [{ columns: ['A', 'B'], rows: [['1', '2']] }]]);
  } finally { clearTimeout(timer); await worker.terminate(); }
});

test('hyphen-only underlines remain headings while colon-aligned single columns remain tables', () => {
  for (const divider of ['-', '--', '---', ' ---  ']) {
    const source = `| Name |\n${divider}\n| Ana |\n| Ben |\n| Céline |`;
    assert.doesNotMatch(render(source), /<table>/);
    assert.deepEqual(parseTables(source), []);
  }
  const source = '| Name |\n:-:\n| Ana |\n| Ben |\n| Céline |';
  assert.match(render(source), /<table>/);
  assert.deepEqual(parseTables(source), [{ columns: ['Name'], rows: [['Ana'], ['Ben'], ['Céline']] }]);
});

test('Saved Work and CSV retain all visible table rows without changing the reply', () => {
  const source = `# Results\n\n${table('|-|-|')}\n\n    ${table().replaceAll('\n', '\n    ')}\n\n${table('|---|')}`;
  const chat = { id: 'chat', title: 'Results', updated: 1, messages: [{ id: 'reply', role: 'assistant', content: source }] };
  const before = JSON.stringify(chat);
  const items = collectWork([chat]).filter(item => item.kind === 'table');
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].item.rows, expected.rows);
  assert.equal(items[0].item.messageId, 'reply');
  assert.match(toCSV(items[0].item.columns, items[0].item.rows), /Céline,3/);
  assert.equal(JSON.stringify(chat), before);
});

test('ordinary extracted cell conventions, table order, and CRLF input stay intact', () => {
  const source = '| Name | Expression |\n|---|---|\n| **bold** | `a_b` |\n| user_name | 5 * 3 |\n| escaped \\| pipe | 2 |';
  assert.deepEqual(parseTables(`${source}\r\n\r\n${table().replaceAll('\n', '\r\n')}`), [
    { columns: ['Name', 'Expression'], rows: [['bold', 'a_b'], ['user_name', '5 * 3'], ['escaped | pipe', '2']] }, expected,
  ]);
  for (const empty of ['', 'ordinary prose', '| header |\n|---|']) assert.deepEqual(parseTables(empty), []);
});
