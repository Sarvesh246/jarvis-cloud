import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeContent, composedLength } from '../src/lib/attachments.js';

test('cached file lengths match the exact outbound message for every draft', () => {
  const files = [
    { state: 'ready', name: 'guide.md', body: 'Nested fences:\n````md\n```js\nx()\n```\n````\n日本語 👋' },
    { state: 'ready', name: 'data.csv', body: 'name,value\nA,0\nB,-1\n' },
    { state: 'reading', name: 'loading.txt', body: 'Not ready' },
    { state: 'ready', kind: 'image', name: 'photo.png' },
    { state: 'unsupported', name: 'bad.txt', body: 'Not sent' },
  ];
  for (const attachments of [[], files, files.slice(1, 2), files.slice(2)]) {
    const cached = composeContent('', attachments).length;
    for (const text of ['', ' ', '\n\t', 'Question', '  Question\n', '日本語 👋', 'x'.repeat(300_000)])
      assert.equal(composedLength(text, cached), composeContent(text, attachments).length);
  }
});

test('editing or removing attachments refreshes the count without changing payloads', () => {
  const original = [{ state: 'ready', name: 'a.txt', body: 'Short' }];
  const edited = [{ ...original[0], body: 'A much longer revision with ``` fences' }];
  for (const files of [original, edited, []])
    assert.equal(composedLength('Review', composeContent('', files).length), composeContent('Review', files).length);
});
