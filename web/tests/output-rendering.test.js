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
  } finally { await server.close(); }
});
