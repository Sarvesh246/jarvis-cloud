import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { tableRenderingFixtures } from './fixtures/chat-outputs/table-rendering.js';

test('table formulas retain generated math and use one TeX value for table data', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  try {
    const { Rendered, PresentationContext } = await server.ssrLoadModule('/src/components/blocks/Blocks.jsx');
    const render = content => renderToStaticMarkup(React.createElement(PresentationContext.Provider, { value: 'minimal' }, React.createElement(Rendered, { content, onOpen() {} })));
    for (const fixture of tableRenderingFixtures.filter(f => f.mathCount)) {
      const html = render(fixture.content);
      assert.equal((html.match(/class="katex"/g) || []).length, fixture.mathCount, fixture.id);
      assert.equal((html.match(/class="katex-mathml"/g) || []).length, fixture.mathCount);
      assert.equal((html.match(/class="katex-html" aria-hidden="true"/g) || []).length, fixture.mathCount);
      assert.doesNotMatch(html, /block-fallback/);
    }
    const html = render(tableRenderingFixtures.find(f => f.id === 'table-math').content);
    assert.match(html, /aria-label="Sort by x\^2"/);
    assert.doesNotMatch(html, /Sort by x2x\^2x2/);
    const malformed = render(tableRenderingFixtures.find(f => f.id === 'table-malformed').content);
    assert.match(malformed, /class="katex-error"/);
    assert.match(malformed, /\\frac\{1\}\{2/);
    assert.match(malformed, /<code>x\^2<\/code>/);
    const hostile = render('| Formula |\n| --- |\n| $\\href{javascript:alert(1)}{x}$ |');
    assert.doesNotMatch(hostile, /href="javascript:/);
    assert.doesNotMatch(hostile, /<script|onerror=/);
  } finally { await server.close(); }
});
