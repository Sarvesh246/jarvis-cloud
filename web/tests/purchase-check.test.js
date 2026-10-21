import test from 'node:test';
import assert from 'node:assert/strict';
import { runCheck, CheckInputError } from '../server/check-engine.js';

const calculate = input => runCheck('purchase', input);
const invalid = error => error instanceof CheckInputError && error.statusCode === 400;

test('purchase prices prefer explicit money over product model numbers', async () => {
  const input = { options: 'Printer 2000 $200, $20 a year\nPrinter 3000 $250, $5 a year', years: '3 years', budget: '$270' };
  const original = structuredClone(input);
  const { result } = await calculate(input);
  assert.equal(result.best, 'Printer 2000');
  assert.deepEqual(result.options.map(item => [item.name, item.price, item.total, item.overBudget]), [
    ['Printer 2000', 200, 260, false], ['Printer 3000', 250, 265, false],
  ]);
  assert.deepEqual(input, original);
  assert.deepEqual(await calculate(input), await calculate(input));
});

test('purchase prices keep numeric Unicode names and unmarked recurring costs', async () => {
  for (const [options, name, symbol] of [
    ['Écran 4K €200, 10 per year', 'Écran 4K', '€'],
    ['印刷機 3000 200 dollars, 10 per year', '印刷機 3000', '$'],
    ['Printer 2000 20 a year, $200', 'Printer 2000', '$'],
  ]) {
    const { result } = await calculate({ options, years: '2' });
    assert.equal(result.symbol, symbol);
    assert.equal(result.options[0].name, name);
    assert.equal(result.options[0].price, 200);
    assert.equal(result.options[0].total, options.includes('20 a year') ? 240 : 220);
  }
});

test('purchase duration rejects negative, unsupported and partial quantities', async () => {
  for (const years of ['-3 years', '−3 years', '3 weeks', '3 days', '1 year 6 months', '3 years 2', '1e2 years', '3.5.2', '3 or 5 years', 'Infinity', '51 years', '601 months']) {
    await assert.rejects(calculate({ options: 'Printer $200, $20 a year', years }),
      error => invalid(error) && /how long/.test(error.message), years);
  }
});

test('purchase duration preserves defaults, months, fractions and zero', async () => {
  for (const [years, expected] of [['', 3], ['3', 3], ['3 years', 3], ['1 year', 1], ['18 months', 1.5], ['6 mos', 0.5], ['2 yrs', 2], ['0 years', 0], ['0 months', 0], ['1.5 years', 1.5], ['50 years', 50], ['600 months', 50]]) {
    const { result } = await calculate({ options: 'Printer $200, $20 a year', years });
    assert.equal(result.years, expected, years);
    assert.equal(result.options[0].total, 200 + 20 * expected, years);
  }
});

test('purchase comparison retains unmarked prices, monthly costs and currency validation', async () => {
  const { result } = await calculate({ options: 'Printer 200, 20 a year\nInkjet 80, 8 a month', years: '18 months', budget: '230' });
  assert.deepEqual(result.options.map(item => [item.name, item.total, item.overBudget]), [['Inkjet', 224, false], ['Printer', 230, false]]);
  await assert.rejects(calculate({ options: 'Printer $200, €20 a year' }), /one kind of money/);
  await assert.rejects(calculate({ options: 'Printer $200', budget: '€300' }), /one kind of money/);
  await assert.rejects(calculate({ options: 'Printer $999999999999999' }), /too big/);
});

test('recurring costs preserve their position, frequency and rounding', async () => {
  for (const options of ['Printer 2000 $8 a month, $200', 'Printer 2000 $200, 8 per month', 'Printer 2000 $200, $8 monthly']) {
    const { result } = await calculate({ options, years: '6 months', budget: '$247.99' });
    assert.deepEqual(result.options, [{ name: 'Printer 2000', price: 200, yearly: 96, total: 248, overBudget: true }]);
    assert.equal(result.status, 'none-fit');
    assert.equal(result.best, null);
  }
  const { result } = await calculate({ options: 'Printer 2000 $0, $0.01 monthly, $0.01 annually', years: '18 months' });
  assert.equal(result.options[0].total, 0.2);
  assert.equal(result.options[0].price, 0);
});
