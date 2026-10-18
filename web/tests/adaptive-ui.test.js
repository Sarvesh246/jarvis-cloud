import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inferListPresentation, safeChartPlan, sectionContext, tablePresentation, wantsPlainReply, requestForReply } from '../src/lib/adaptive-ui.js';
import { REPLY_FORMAT_GUIDANCE, chatInput } from '../server/chat.js';

test('ordinary packing and planning answers become checklists without UI requests', () => {
  assert.deepEqual(inferListPresentation(['Water bottle', 'A warm layer', 'Phone charger'], { context: 'Packing list' }), { kind: 'checklist' });
  assert.deepEqual(inferListPresentation(['Book a room.', 'Check the route.', 'Pack a small bag.'], { ordered: true }), { kind: 'checklist' });
  assert.deepEqual(inferListPresentation(['Book a room.', 'Check the route.', 'Pack a small bag.']), { kind: 'checklist' });
  assert.equal(inferListPresentation(['Fast', 'Flexible', 'Lightweight'], { context: 'Benefits' }), null);
  assert.equal(inferListPresentation(['Check engine light', 'Call failures'], { context: 'Symptoms', ordered: true }), null);
  assert.equal(inferListPresentation(['One suggestion']), null);
});

test('ordinary dated lists and numeric summaries select timeline and figures', () => {
  assert.deepEqual(inferListPresentation(['**Monday:** Arrive', 'Wednesday — Visit the museum']), {
    kind: 'timeline', source: 'Monday: Arrive\nWednesday: Visit the museum',
  });
  assert.equal(inferListPresentation(['9:30 AM: Breakfast', '11 AM: Train']).kind, 'timeline');
  assert.equal(inferListPresentation(['2024: Founded', '2025: Opened a second site']).kind, 'timeline');
  assert.deepEqual(inferListPresentation(['**Revenue:** $12,450 (+8%)', 'Orders: 183', 'Refunds: 7']), {
    kind: 'metrics', source: 'Revenue: $12,450 (+8%)\nOrders: 183\nRefunds: 7',
  });
  assert.equal(inferListPresentation(['Average sleep: 7.4 hours', 'Walking distance: 28 km']).kind, 'metrics');
});

test('ambiguous data, rich sources, code, nested/oversized lists are not rewritten as figures', () => {
  assert.equal(inferListPresentation(['Benefit: Flexible', 'Drawback: Expensive']), null);
  assert.equal(inferListPresentation(['Monday: Arrive', 'Some day: Decide']), null);
  assert.equal(inferListPresentation(['Price: $10', 'Quantity: 2'], { rich: true }), null);
  assert.equal(inferListPresentation(['Price: $10', 'Note: estimate only']), null);
  assert.equal(inferListPresentation(Array(81).fill('Pack a bag'), { context: 'Packing' }), null);
  assert.equal(inferListPresentation(['x'.repeat(50001), 'y']), null);
});

test('time series and quantitative categories default to charts; comparisons remain tables', () => {
  const rows = [['January', '120'], ['February', '180'], ['March', '145']];
  assert.equal(tablePresentation(['Month', 'Sales'], rows).view, 'chart');
  assert.equal(tablePresentation(['Channel', 'Visits'], rows).view, 'chart');
  assert.equal(tablePresentation(['Channel', 'Visits'], rows, 'Compare options').view, 'table');
  assert.equal(tablePresentation(['Plan', 'Price', 'Battery hours', 'Best for'], [['Basic', '$20', '8', 'Travel'], ['Plus', '$30', '12', 'Home']]).view, 'table');
  assert.equal(tablePresentation(['Month', 'Sales'], [['Jan', 'n/a'], ['Feb', '8']]).view, 'table');
  assert.equal(tablePresentation(['Month', 'Sales'], [['Jan', '$8'], ['Feb', '€9']]).view, 'table');
  assert.equal(tablePresentation(['Month', 'Sales'], Array(200).fill(['Jan', '8'])).view, 'chart');
  assert.equal(tablePresentation(['Month', 'Sales'], Array(201).fill(['Jan', '8'])).view, 'table');
});

test('numeric years are labels rather than a second quantitative bar series', () => {
  const rows = [['2024', '120'], ['2025', '180']];
  assert.deepEqual(safeChartPlan(['Year', 'Sales'], rows), { label: 0, values: [1] });
  assert.equal(tablePresentation(['Year', 'Sales'], rows).view, 'chart');
});

test('quantities and budgets surface local calculation controls without invented formulas', () => {
  assert.deepEqual(tablePresentation(['Ingredient', 'Amount', 'Unit'], [['Rice', '300', 'g'], ['Beans', '400', 'g']]), { view: 'table', explore: true });
  assert.deepEqual(tablePresentation(['Category', 'Monthly cost'], [['Rent', '$1200'], ['Food', '$350']], 'Monthly budget'), { view: 'table', explore: true });
  assert.equal(tablePresentation(['Plan', 'Monthly cost'], [['Basic', '$20'], ['Plus', '$30']]).explore, false);
});

test('section context is local and explicit plain-format requests disable automatic presentation', () => {
  const content = '# Packing list\n- Water\n\n## Benefits\n- Lightweight\n';
  assert.equal(sectionContext(content, content.indexOf('- Lightweight')), 'Benefits');
  for (const request of ['Plain text please', 'Use prose only.', 'No charts.', 'No widgets.']) assert.equal(wantsPlainReply(request), true);
  assert.equal(wantsPlainReply('Help me plan a weekend away'), false);
  assert.equal(wantsPlainReply([{ type: 'text', text: 'hello' }]), false);
});

test('each reply uses its own user request, not the newest turn or an attachment payload', () => {
  const messages = [
    { role: 'user', text: 'Plain text please', content: 'composed request with attachments' },
    { role: 'assistant', content: 'Earlier answer' },
    { role: 'user', content: 'Help me plan a trip' },
    { role: 'assistant', content: 'Later answer' },
  ];
  assert.equal(requestForReply(messages, 1), 'Plain text please');
  assert.equal(requestForReply(messages, 3), 'Help me plan a trip');
  assert.equal(requestForReply(messages, 0), '');
  assert.equal(requestForReply(messages, 2), '');
  assert.equal(requestForReply([{ role: 'user', content: [{ type: 'image_url' }] }], 1), '');
});

test('format selection reuses a shorter existing instruction block and does not create another request', () => {
  assert.ok(REPLY_FORMAT_GUIDANCE.length <= 876);
  assert.ok(REPLY_FORMAT_GUIDANCE.split(/\s+/).length <= 156);
  assert.match(REPLY_FORMAT_GUIDANCE, /automatically; never wait/);
  assert.match(REPLY_FORMAT_GUIDANCE, /comparisons/);
  assert.match(REPLY_FORMAT_GUIDANCE, /```timeline/);
  const input = chatInput({ conversationId: '0ef3a063-f0d0-44f7-b9dc-774137b1d86c', messages: [{ role: 'user', content: 'Help me pack for a weekend away.' }] });
  assert.equal(input.messages.length, 1);
  const source = readFileSync(new URL('../src/lib/adaptive-ui.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|WebSocket|\beval\s*\(|new Function/);
});

test('what was asked decides between chart and table for the same data', async () => {
  const { requestIntent } = await import('../src/lib/adaptive-ui.js');
  const rows = [['Basic', '$20'], ['Plus', '$30'], ['Pro', '$45']];
  assert.equal(requestIntent('Show the trend of sales over time'), 'chart');
  assert.equal(requestIntent('Compare the plans side by side'), 'table');
  assert.equal(requestIntent('Put it in a table'), 'table');
  assert.equal(requestIntent('What is the capital of France?'), null);
  assert.equal(tablePresentation(['Plan', 'Price'], rows, '', 'Show me a chart of the price breakdown').view, 'chart');
  assert.equal(tablePresentation(['Plan', 'Price'], rows, '', 'Compare the plans').view, 'table');
  assert.equal(tablePresentation(['Month', 'Sales'], [['Jan', '120'], ['Feb', '180']], '', 'Give me this in a table').view, 'table');
  assert.equal(tablePresentation(['Month', 'Sales', 'Cost', 'Profit'], [['Jan', '1', '1', '1'], ['Feb', '2', '1', '1']], '', 'Graph the monthly results').view, 'chart');
});

test('summaries become cards and file trees become browsers without being asked', async () => {
  const { overviewItems } = await import('../src/lib/adaptive-ui.js');
  const { treePaths } = await import('../src/lib/rich-ui.js');
  const costs = [['Hotel', '$480'], ['Food', '$160'], ['Total', '$640']];
  assert.equal(tablePresentation(['Item', 'Cost'], costs, 'Trip costs').view, 'cards');
  assert.equal(tablePresentation(['Region', 'Revenue'], [['North', '$1'], ['South', '$2']], 'Revenue summary').view, 'cards');
  assert.equal(tablePresentation(['Item', 'Cost'], costs, 'Trip costs', 'Compare these').view, 'table');
  assert.equal(tablePresentation(['Plan', 'Price'], [['A', '$1'], ['B', '$2']], 'Pricing').view, 'table');
  assert.equal(tablePresentation(['Month', 'Sales'], [['Jan', '120'], ['Feb', '180'], ['Total', '300']], 'Sales').view !== 'cards', true);
  assert.equal(overviewItems(['Item', 'Cost'], Array(9).fill(['Rent', '$1'])), null);
  assert.equal(tablePresentation(['Category', 'Monthly cost'], [['Rent', '$1200'], ['Food', '$350']], 'Monthly budget').view, 'table');
  assert.deepEqual(treePaths('app/\n├── src/\n│   └── main.js\n└── package.json', '').paths, ['app/src/main.js', 'app/package.json']);
  assert.equal(treePaths('a\nb\nc', ''), null);
  assert.equal(treePaths('├── a\n├── b\n└── c', 'js'), null);
});
