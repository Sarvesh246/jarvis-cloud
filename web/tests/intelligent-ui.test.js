import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { blockKey, readChecklist, saveChecklist, visibleRows, numberSeries, scaleSeries } from '../src/lib/intelligent-ui.js';

const memory = () => {
  const data = new Map();
  return { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value), data };
};
test('checklist state survives reloads, isolates messages, and invalidates changed blocks', () => {
  const storage = memory();
  const key = blockKey('message-a', 12, 'Pack water');
  assert.equal(saveChecklist(key, [true, false], storage), true);
  assert.deepEqual(readChecklist(key, [false, false], storage), [true, false]);
  assert.deepEqual(readChecklist(blockKey('message-b', 12, 'Pack water'), [false, false], storage), [false, false]);
  assert.deepEqual(readChecklist(blockKey('message-a', 12, 'Pack food'), [false, false], storage), [false, false]);
  assert.deepEqual(readChecklist(key, [false], storage), [false]);
});
test('blocked or damaged storage never prevents a checklist from working', () => {
  const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('quota'); } };
  assert.deepEqual(readChecklist('key', [false], blocked), [false]);
  assert.equal(saveChecklist('key', [true], blocked), false);
  const storage = memory();
  storage.setItem('vaelo-local-checklists-v1', '{bad');
  assert.deepEqual(readChecklist('key', [false], storage), [false]);
});
test('local storage is bounded and saves only completion booleans and opaque keys', () => {
  const storage = memory();
  for (let i = 0; i < 205; i++) saveChecklist(`message-${i}`, [false], storage);
  const saved = JSON.parse(storage.getItem('vaelo-local-checklists-v1'));
  assert.equal(Object.keys(saved).length, 200);
  assert.equal(saved['message-0'], undefined);
  assert.deepEqual(saved['message-204'], [false]);
});
test('filters intersect selected rows without changing source data or row identity', () => {
  const rows = [['Alpha', '$10'], ['Beta', '$15'], ['Gamma', '$20']];
  const original = structuredClone(rows);
  assert.deepEqual(visibleRows(rows, '  ALPHA  '), [0]);
  assert.deepEqual(visibleRows(rows, '', [0, 2], true), [0, 2]);
  assert.deepEqual(visibleRows(rows, 'beta', [0, 2], true), []);
  assert.deepEqual(visibleRows(rows, '<script>'), []);
  assert.deepEqual(rows, original);
});
test('numeric exploration refuses mixed units, missing numbers and overflow', () => {
  assert.equal(numberSeries([['$10'], ['€12']], 0), null);
  assert.equal(numberSeries([['10%'], ['12']], 0), null);
  assert.equal(numberSeries([['10'], ['n/a']], 0), null);
  assert.equal(numberSeries([['10'], ['']], 0), null);
  assert.equal(numberSeries([['9'.repeat(400)]], 0), null);
  const series = numberSeries([['-12%'], ['8%'], ['0%']], 0);
  assert.deepEqual(scaleSeries(series, '2'), { numbers: [-24, 16, 0], unit: '%' });
  assert.deepEqual(series.numbers, [-12, 8, 0]);
  assert.equal(scaleSeries(series, ''), null);
  assert.equal(scaleSeries(series, 'Infinity'), null);
  assert.equal(scaleSeries(series, '1000001'), null);
  assert.equal(scaleSeries(series, 'alert(1)'), null);
});
test('local UI modules have no network, model, execution or conversation mutation dependencies', () => {
  for (const file of ['../src/lib/intelligent-ui.js', '../src/components/blocks/LocalTools.jsx']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|\beval\s*\(|new Function|server\/chat|requestRevision|onAction/);
  }
});
