import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

test('rendered tables keep image descriptions and safe links instead of empty cells', async () => {
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  try {
    const { Rendered } = await server.ssrLoadModule('/src/components/blocks/Blocks.jsx');
    const html = renderToStaticMarkup(React.createElement(Rendered, {
      content: '| Item | Preview |\n|---|---|\n| One | ![Diagram](https://example.com/diagram.png) |\n| Two | [Unsafe](javascript:alert) |',
      sources: [], onOpen() {},
    }));
    assert.ok(html.includes('Diagram'), 'an image-only cell has readable output');
    assert.ok(html.includes('https://example.com/diagram.png'));
    assert.ok(!html.includes('href="javascript:'), 'inline table rendering preserves URL filtering');
    assert.ok(!html.includes('block-fallback'), 'ordinary model output renders without falling back');
    const render = (content, live = false) => renderToStaticMarkup(React.createElement(Rendered, {content, live, sources:[], onOpen() {}}));
    const empty = render('```metrics\n# Empty figures\n```\n\n```timeline\n# Empty timeline\n```');
    assert.ok(empty.includes('No figures were included'));
    assert.ok(empty.includes('No events were included'));
    assert.ok(!empty.includes('Laying out'));
    const incomplete = render('```vaelo-work\n{broken json}');
    assert.ok(incomplete.includes('{broken json}'));
    assert.ok(incomplete.includes('incomplete'));
    const kinds = [
      '- [ ] Pack documents\n- [x] Confirm dates',
      '```metrics\n# Summary\nLong number: $123456789012345678901234567890\nOther: 4\n```',
      '```timeline\nMonday: Prepare\nTuesday: Review\n```',
      '```javascript\nconst value = 42;\n```',
      '```html\n<h1>A preview</h1>\n```',
      '```svg\n<svg xmlns="http://www.w3.org/2000/svg"></svg>\n```',
      '[A source](https://example.com/)\n\n![Remote image](https://example.com/image.png)',
      '```vaelo-work\n{"workspaceId":"custom","title":"Review this draft"}\n```',
      '> A quotation\n\nA **formatted** paragraph with `inline_code`.',
    ];
    for (const content of kinds) {
      for (const live of [false, true]) assert.ok(!render(content, live).includes('block-fallback'), content);
    }
    const long = '| Month | Revenue |\n|---|---|\n' + Array.from({length:96}, (_, i) => `| Month ${i+1} | $${i*27} |`).join('\n');
    const chart = render(long);
    assert.ok(chart.includes('line-plot'));
    assert.ok(chart.includes('All 96 rows'));
    assert.ok(!chart.includes('NaN'));
    assert.ok(!chart.includes('block-fallback'));
  } finally { await server.close(); }
});
