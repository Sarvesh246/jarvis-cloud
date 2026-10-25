import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { safeChartPlan } from '../src/lib/adaptive-ui.js';
import { stackedSeries } from '../src/lib/rich-ui.js';
import { chartChange } from '../src/lib/charts.js';

const decimal = value => value < 0 ? '-' + '1' + '0'.repeat(308) : '1' + '0'.repeat(308);

test('line chart change stays accurate when finite endpoints overflow during subtraction', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  try {
    const { Chart } = await server.ssrLoadModule('/src/components/blocks/Chart.jsx');
    const cases = [
      [[decimal(-1), decimal(1)], '200.0%'],
      [[decimal(1), decimal(-1)], '-200.0%'],
      [['0.1', '0.2'], '100.0%'],
      [['-10', '-5'], '50.0%'],
      [['0', '2'], '2 absolute'],
      [['2', '0'], '-100.0%'],
      [['5', '5'], '0.0%'],
      [['N/A', '2'], '—'],
    ];
    for (const [values, expected] of cases) {
      const columns = ['Month', 'Value'];
      const rows = values.map((value, i) => [i ? 'Feb' : 'Jan', value]);
      const plan = safeChartPlan(columns, rows);
      assert.ok(plan);
      const html = renderToStaticMarkup(React.createElement(Chart, { columns, rows, plan }));
      assert.ok(html.includes(`<span>Change<b>${expected}</b></span>`), `${values}: ${html.match(/<span>Change.*?<\/span>/)?.[0]}`);
      assert.doesNotMatch(html, /NaN|Infinity/);
      assert.ok(html.includes(values.at(-1)), 'supplied value remains available');
    }
  } finally { await server.close(); }
});

test('unrepresentable percentage changes display the existing unavailable marker', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  try {
    const { Chart } = await server.ssrLoadModule('/src/components/blocks/Chart.jsx');
    const columns = ['Month', 'Value'];
    const rows = [['Jan', '0.' + '0'.repeat(307) + '1'], ['Feb', decimal(1)]];
    const html = renderToStaticMarkup(React.createElement(Chart, { columns, rows, plan: safeChartPlan(columns, rows) }));
    assert.ok(html.includes('<span>Change<b>—</b></span>'));
    assert.doesNotMatch(html, /NaN|Infinity/);
    assert.ok(html.includes(rows[1][1]));
  } finally { await server.close(); }
});

test('stacked charts scale fractional totals to their supplied maximum', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  try {
    const { SeriesChart } = await server.ssrLoadModule('/src/components/blocks/SeriesChart.jsx');
    for (const factor of [1, .001, 1e-100]) {
      const unit = factor === 1e-100 ? '0.' + '0'.repeat(99) : null;
      const rows = unit ? [['Jan', unit + '1', unit + '1'], ['Feb', unit + '2', unit + '2']] :
        [['Jan', String(.1 * factor), String(.1 * factor)], ['Feb', String(.2 * factor), String(.2 * factor)]];
      const data = stackedSeries(['Month', 'A', 'B'], rows, [1, 2], 0);
      assert.ok(data);
      assert.equal(data.max, data.points[1].values.reduce((a, b) => a + b, 0));
      const html = renderToStaticMarkup(React.createElement(SeriesChart, { data }));
      assert.deepEqual([...html.matchAll(/--height:([^";]+)/g)].map(match => match[1]), ['50%', '100%']);
      assert.deepEqual([...html.matchAll(/style="flex:([^";]+)/g)].map(match => Number(match[1])), [50, 50, 50, 50]);
      assert.doesNotMatch(html, /NaN|Infinity/);
    }
    const zeros = stackedSeries(['Month', 'A', 'B'], [['Jan', '0', '0'], ['Feb', '0', '0']], [1, 2], 0);
    assert.equal(zeros.max, 1);
    const html = renderToStaticMarkup(React.createElement(SeriesChart, { data: zeros }));
    assert.deepEqual([...html.matchAll(/--height:([^";]+)/g)].map(match => match[1]), ['0%', '0%']);
    assert.doesNotMatch(html, /NaN|Infinity/);
  } finally { await server.close(); }
});

test('chart change ignores gaps and retains ordinary rounding without mutating points', () => {
  for (const [values, expected] of [
    [[], '—'], [[NaN, Infinity, -Infinity], '—'], [[1, NaN], '—'],
    [[NaN, -10, Infinity, -5, NaN], '50.0%'],
    [[0, NaN, -2], '-2 absolute'], [[-0, 0], '0 absolute'],
    [[3, 4], '33.3%'], [[-3, -4], '-33.3%'],
    [[-Number.MAX_VALUE, Number.MAX_VALUE], '200.0%'],
  ]) {
    const points = Object.freeze(values.map(value => Object.freeze({ value })));
    assert.equal(chartChange(points), expected);
  }
});

test('stacked segment weights stay proportional beyond the CSS numeric range', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  try {
    const { SeriesChart } = await server.ssrLoadModule('/src/components/blocks/SeriesChart.jsx');
    for (const suffix of ['', '0'.repeat(100), '0'.repeat(307)]) {
      const rows = [['Jan', '2' + suffix, '3' + suffix], ['Feb', '1' + suffix, '4' + suffix]];
      const data = stackedSeries(['Month', 'A', 'B'], rows, [1, 2], 0);
      const html = renderToStaticMarkup(React.createElement(SeriesChart, { data }));
      const weights = [...html.matchAll(/style="flex:([^";]+)/g)].map(match => Number(match[1]));
      assert.equal(weights.length, 4);
      weights.forEach((weight, i) => assert.ok(Math.abs(weight - [40, 60, 20, 80][i]) < 1e-10));
      assert.doesNotMatch(html, /NaN|Infinity/);
    }
    assert.equal(stackedSeries(['Month', 'A', 'B'], [['Jan', decimal(1), decimal(1)]], [1, 2], 0), null);
  } finally { await server.close(); }
});
