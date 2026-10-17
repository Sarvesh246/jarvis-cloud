import test from 'node:test';
import assert from 'node:assert/strict';
import { fitTitle, chatTitle, displayChatTitle } from '../src/lib/titles.js';
import { chartData, lineGeometry, temporalColumn, compactNumber } from '../src/lib/charts.js';
import { safeChartPlan, tablePresentation } from '../src/lib/adaptive-ui.js';
import { parseMetrics, parseTimeline } from '../src/lib/structured.js';
import { numberSeries } from '../src/lib/intelligent-ui.js';

test('generated and fitted chat titles end on complete words within the available space', () => {
  const text = 'Compare the iPhone 18 Pro Max to my current iPhone and explain the differences';
  const title = chatTitle(text);
  assert.ok(title.length <= 48);
  assert.equal(title, 'Compare the iPhone 18 Pro Max to my current…');
  const fit = fitTitle(text, value => value.length <= 26);
  assert.equal(fit, 'Compare the iPhone 18 Pro…');
  assert.equal(fitTitle('Short title', value => value.length <= 50), 'Short title');
  assert.equal(fitTitle('oneVeryLongWord', value => value.length <= 5), '…');
  assert.equal(fitTitle(text, () => false), '');
  assert.equal(chatTitle('x'.repeat(100)), 'New conversation');
  assert.ok(!chatTitle('😀 '.repeat(30)).includes('\ufffd'));
  assert.equal(displayChatTitle({title:text.slice(0,48), messages:[{text}]}), chatTitle(text));
  assert.equal(displayChatTitle({title:'My own name', messages:[{text}]}), 'My own name');
});

test('long charts retain every row and comparisons stay tables by default', () => {
  const rows = Array.from({length: 200}, (_, i) => [`2026-${i + 1}`, `${i}`]);
  assert.deepEqual(safeChartPlan(['Month', 'Revenue'], rows), {label:0, values:[1]});
  assert.equal(safeChartPlan(['Month', 'Revenue'], [...rows, ['more', '1']]), null);
  assert.equal(tablePresentation(['Month', 'Revenue'], rows, 'Monthly revenue').view, 'chart');
  assert.equal(tablePresentation(['Option', 'Revenue'], rows, 'Compare products').view, 'table');
  const data = chartData(['Month','Revenue'], rows, 1, 0);
  assert.equal(data.points.length, 200);
  assert.equal(data.max, 199);
  assert.ok(data.summary.includes('199'));
});

test('filtered and grouped charts handle empty views, gaps, mixed signs and units honestly', () => {
  const rows = [['Region A', ''], ['First', '-12'], ['Missing', 'N/A'], ['Last', '8']];
  const data = chartData(['Label','Change'], rows, 1, 0);
  assert.equal(data.points.length, 3);
  assert.equal(data.points[0].section, 'Region A');
  assert.equal(data.signed, true);
  assert.equal(data.max, 12);
  assert.equal(chartData(['Label','Value'], [['x','N/A']], 1, 0).finite.length, 0);
  assert.deepEqual(safeChartPlan(['Month','Revenue'], [['Jan','$12'], ['Feb','—'], ['Mar','$18']]), {label:0, values:[1]});
  assert.equal(safeChartPlan(['Month','Revenue'], [['Jan','$12'], ['Feb','€18']]), null);
  assert.deepEqual(numberSeries([['(12%)'], ['8%']], 0), {numbers:[-12,8], unit:'%'});
});

test('line geometry preserves gaps and stays finite for constant and extreme series', () => {
  for (const numbers of [[0,0,0], [-3,8,-1], [-1e308,1e308], [.0000000001,.0000000002]]) {
    const geometry = lineGeometry(numbers.map((value,i) => ({value,label:`Row ${i}`})));
    assert.ok(geometry.points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)));
    assert.ok(geometry.ticks.every(tick => Number.isFinite(tick.value)));
    assert.ok(geometry.points.every(point => point.y >= 24 && point.y <= 220));
  }
  assert.equal(lineGeometry([{value:1},{value:NaN},{value:3}]).paths.length, 2);
  assert.equal(lineGeometry([]).paths.length, 0);
  assert.equal(temporalColumn('Revenue', [{label:'A'},{label:'B'}]), false);
  assert.equal(temporalColumn('Month', [{label:'Jan'},{label:'Feb'}]), true);
  assert.ok(compactNumber(1e-12).length < 10);
});

test('secondary headings in structured output are preserved rather than dropped', () => {
  assert.deepEqual(parseMetrics('# Revenue\nValue: $12\n# Caveat\nDraft figures').extra, ['Caveat','Draft figures']);
  assert.deepEqual(parseTimeline('# Plan\nMonday: Start\n# Later\nStill pending').rows.map(row => row.what), ['Start','Later','Still pending']);
  assert.equal(parseTimeline('Early October, pending final accessibility verification: Public beta — Check every screen reader').events[0].when, 'Early October, pending final accessibility verification');
});
