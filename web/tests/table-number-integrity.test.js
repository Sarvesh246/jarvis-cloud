import test from 'node:test';
import assert from 'node:assert/strict';
import { toNumber, isNumericColumn, sortRows, tableView, toCSV, toTSV } from '../src/lib/table.js';
import { chartData } from '../src/lib/charts.js';
import { safeChartPlan } from '../src/lib/adaptive-ui.js';
import { numberSeries, scaleSeries } from '../src/lib/intelligent-ui.js';
import { stackedSeries } from '../src/lib/rich-ui.js';

const signs = ['-', '+', '−'];
const currencies = ['', '$', '€', '£', '¥', '₹'];
const conflicting = currencies.flatMap(currency => signs.flatMap(first => signs.map(second => `${first}${currency}${second}5`)));

test('conflicting numeric signs remain literal table text', () => {
  for (const value of conflicting) {
    assert.ok(Number.isNaN(toNumber(value)), value);
    assert.ok(Number.isNaN(toNumber(`≈ ${value}`)), `approximate ${value}`);
    assert.ok(Number.isNaN(toNumber(`${value}k`)), `scaled ${value}`);
  }
});

test('accounting brackets cannot reverse an already signed amount', () => {
  for (const currency of currencies) {
    for (const sign of signs) {
      for (const value of [`(${currency}${sign}5)`, `(${sign}${currency}5)`, `${currency}(${sign}5)`, `(~${sign}${currency}5)`]) {
        assert.ok(Number.isNaN(toNumber(value)), value);
      }
    }
  }
});

test('valid signed currencies and accounting values retain their exact interpretation', () => {
  for (const currency of currencies) {
    for (const [body, amount] of [['0', 0], ['.5', .5], ['1,200.25', 1200.25], ['4.2k', 4200], ['2M', 2e6], ['3b', 3e9], ['12%', 12]]) {
      assert.equal(toNumber(`${currency}${body}`), amount);
      for (const sign of signs) {
        const expected = sign === '+' ? amount : -amount;
        assert.equal(toNumber(`${sign}${currency}${body}`), expected);
        assert.equal(toNumber(`${currency}${sign}${body}`), expected);
      }
      assert.equal(toNumber(`(${currency}${body})`), amount === 0 ? 0 : -amount);
      assert.equal(toNumber(`${currency}(${body})`), amount === 0 ? 0 : -amount);
    }
  }
  assert.equal(toNumber('≈ − ₹ 1\u202f200.25'), -1200.25);
  assert.equal(toNumber('~ € (50.5)'), -50.5);
});

test('malformed figures cannot silently determine table order or a chart plan', () => {
  for (const value of ['--5', '-$-5', '($-5)', '€−−5']) {
    const rows = [['First', value], ['Second', '10'], ['Third', '2']];
    const before = structuredClone(rows);
    assert.equal(isNumericColumn(rows, 1), false, value);
    assert.equal(safeChartPlan(['Item', 'Amount'], rows), null, value);
    // All cells use the established text comparator if one is not numeric.
    const sorted = sortRows(rows, 1);
    assert.ok(sorted.indexOf(rows[2]) < sorted.indexOf(rows[1]), 'natural text order remains available');
    assert.deepEqual(tableView(rows, { column: 1 }).rows, sorted);
    assert.deepEqual(rows, before);
  }
});

test('chart readings and summaries exclude signed accounting errors', () => {
  const rows = [['Invalid', '($-500)'], ['Gain', '$20'], ['Loss', '($10)'], ['Unknown', 'N/A']];
  const data = chartData(['Item', 'Amount'], rows, 1, 0);
  assert.deepEqual(data.finite.map(point => [point.label, point.value]), [['Gain', 20], ['Loss', -10]]);
  assert.ok(Number.isNaN(data.points[0].value));
  assert.equal(data.points[0].text, '($-500)');
  assert.equal(data.max, 20);
  assert.equal(data.summary, 'Amount: highest is Gain at $20; lowest is Loss at ($10).');
});

test('CSV and clipboard exports guard malformed signed text and preserve real figures', () => {
  const rows = [['--5'], ['-$-5'], ['+€−5'], ['-5'], ['$-5'], ['($5)'], ['($-5)'], ['=1+1']];
  assert.equal(toCSV(['Amount'], rows), "Amount\r\n'--5\r\n'-$-5\r\n'+€−5\r\n-5\r\n$-5\r\n($5)\r\n($-5)\r\n'=1+1");
  assert.equal(toTSV(['Amount'], rows), "Amount\n'--5\n'-$-5\n'+€−5\n-5\n$-5\n($5)\n($-5)\n'=1+1");
});

test('local calculations and stacked breakdowns cannot reuse a reversed accounting amount', () => {
  const columns = ['Item', 'Cash', 'Other'];
  const rows = [['Invalid', '($-500)', '$20'], ['Valid', '$10', '$30']];
  assert.equal(numberSeries(rows, 1), null);
  assert.equal(scaleSeries(numberSeries(rows, 1), 2), null);
  assert.equal(stackedSeries(columns, rows, [1, 2], 0), null);
  rows[0][1] = '$500';
  assert.deepEqual(numberSeries(rows, 1), { numbers: [500, 10], unit: '$' });
  assert.deepEqual(scaleSeries(numberSeries(rows, 1), 2), { numbers: [1000, 20], unit: '$' });
  assert.deepEqual(stackedSeries(columns, rows, [1, 2], 0).points.map(point => point.values), [[500, 20], [10, 30]]);
});
