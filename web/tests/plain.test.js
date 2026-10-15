import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMoney, findAmounts, formatMoney, parseDate, formatDate, parseLines, splitList, splitPair } from '../shared/plain.js';

const now = Date.parse('2026-10-15T12:00:00Z'); // a Thursday

test('money is read the way people write it', () => {
  for (const [text, amount, symbol] of [['$40', 40, '$'], ['40 dollars', 40, '$'], ['£12.50', 12.5, '£'], ['€1,200', 1200, '€'], ['Rs. 500', 500, '₹'],
    ['₹2,50,000'.replace(/,50,/, ',500,'), 2500000, '₹'], ['about 30', 30, null], ['USD 15', 15, '$'], ['15 bucks', 15, '$']])
    assert.deepEqual([parseMoney(text)?.amount, parseMoney(text)?.symbol], [amount, symbol], text);
  assert.equal(parseMoney('$20 on 3 Oct').amount, 20, 'the date is not the amount');
  assert.equal(parseMoney('Paid on Oct 3: 15').amount, 15);
  assert.equal(parseMoney('nothing here'), null);
  assert.deepEqual(findAmounts('Laser printer $200, $20 a year').map(a => a.amount), [200, 20]);
  assert.equal(formatMoney(29.99, '$'), '$29.99'); assert.equal(formatMoney(1500, '£'), '£1,500'); assert.equal(formatMoney(3), '3');
});

test('dates are read the way people say them, day first when numbers are ambiguous', () => {
  for (const [text, date] of [['today', '2026-10-15'], ['tomorrow', '2026-10-16'], ['Friday', '2026-10-16'], ['next friday', '2026-10-16'], ['thursday', '2026-10-22'],
    ['15 Oct', '2026-10-15'], ['Oct 15th', '2026-10-15'], ['1st of November 2026', '2026-11-01'], ['15/10/2026', '2026-10-15'], ['10/15/2026', '2026-10-15'],
    ['3/4', '2026-04-03'], ['in 2 weeks', '2026-10-29'], ['in a month', '2026-11-15'], ['end of month', '2026-10-31'], ['2026-11-01', '2026-11-01']])
    assert.equal(parseDate(text, now), date, text);
  for (const text of ['31 Feb', 'whenever', '', '32/13/2026']) assert.equal(parseDate(text, now), null, text);
  assert.equal(formatDate('2026-10-30'), '30 October 2026');
});

test('lists and pairs come from lines, commas and colons', () => {
  assert.deepEqual(parseLines('- one\n2. two\n\n  • three  '), ['one', 'two', 'three']);
  assert.deepEqual(splitList('Ana, Ben and Cy'), ['Ana', 'Ben', 'Cy']);
  assert.deepEqual(splitList('Rome / Lisbon or Porto'), ['Rome', 'Lisbon', 'Porto']);
  assert.deepEqual(splitPair('Rent: $1,500'), ['Rent', '$1,500']);
  assert.deepEqual(splitPair('Notice - 2 months'), ['Notice', '2 months']);
  assert.deepEqual(splitPair('Just a line'), ['Just a line', '']);
});
