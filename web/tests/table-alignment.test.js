import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { tableRenderingFixtures } from './fixtures/chat-outputs/table-rendering.js';

test('explicit table alignment survives custom cells, headers and numeric inference', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  try {
    const { Rendered, PresentationContext } = await server.ssrLoadModule('/src/components/blocks/Blocks.jsx');
    const content = tableRenderingFixtures.find(f => f.id === 'table-alignment').content;
    for (const presentation of ['minimal', 'adaptive']) for (const live of [false, true]) {
      const html = renderToStaticMarkup(React.createElement(PresentationContext.Provider, { value: presentation }, React.createElement(Rendered, { content, live, requestText: 'Show the original table.', onOpen() {} })));
      assert.equal((html.match(/<th[^>]*data-align="left"/g) || []).length, 2);
      assert.equal((html.match(/<th[^>]*data-align="center"/g) || []).length, 1);
      assert.equal((html.match(/<th[^>]*data-align="right"/g) || []).length, 1);
      assert.match(html, /<td[^>]*data-align="left"[^>]*data-numeric="true"[^>]*>12<\/td>/);
    }
  } finally { await server.close(); }
});
