import test from 'node:test';
import assert from 'node:assert/strict';
import { withGeneratedTitle } from '../src/lib/titles.js';

const chat = () => ({ title: 'Can you help me parse a CSV file using Python?', messages: [
  { id: 'u1', role: 'user', content: 'Can you help me parse a CSV file using Python?' },
  { id: 'a1', role: 'assistant', content: '' },
] });

test('first reply title replaces the prompt fallback and survives storage', () => {
  const original = chat();
  const renamed = withGeneratedTitle(original, 'Python CSV parsing', 'a1');
  assert.equal(renamed.title, 'Python CSV parsing');
  assert.equal(original.title, 'Can you help me parse a CSV file using Python?');
  assert.equal(JSON.parse(JSON.stringify(renamed)).title, 'Python CSV parsing');
  assert.equal(withGeneratedTitle(renamed, renamed.title, 'a1'), renamed);
});

test('manual names and other replies cannot be overwritten by replayed metadata', () => {
  const original = chat();
  const manual = { ...original, title: 'My notes', titleManual: true };
  assert.equal(withGeneratedTitle(manual, 'Python CSV parsing', 'a1'), manual);
  assert.equal(withGeneratedTitle(original, 'Python CSV parsing', 'old-reply'), original);
  const later = { ...original, messages: [...original.messages, { id: 'u2', role: 'user' }] };
  assert.equal(withGeneratedTitle(later, 'Python CSV parsing', 'a1'), later);
});

test('titles are bounded plain text and retain Unicode keywords', () => {
  const original = chat();
  for (const value of [null, {}, '', ' ', 'a'.repeat(49), 'one two three four five six seven', '<b>Python</b>', '**Python**', 'Python\nCSV']) {
    assert.equal(withGeneratedTitle(original, value, 'a1'), original);
  }
  for (const value of ['日本語の旅行計画', 'Café menu ☕', 'iPhone 18 battery comparison']) {
    assert.equal(withGeneratedTitle(original, value, 'a1').title, value);
  }
});
