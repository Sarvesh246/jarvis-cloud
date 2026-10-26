import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

test('chat controls retain their visible labels in their accessible names', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  try {
    const { Header } = await server.ssrLoadModule('/src/components/Header.jsx');
    const { SourceStrip } = await server.ssrLoadModule('/src/components/blocks/Blocks.jsx');
    const header = renderToStaticMarkup(React.createElement(Header, { title: 'Example', onFind() {} }));
    const find = header.match(/<button\b[^>]*class="block-tool header-find"[^>]*>[\s\S]*?<\/button>/)?.[0];
    assert.ok(find);
    assert.doesNotMatch(find, /aria-label=/, 'the name comes from Find and the visible shortcut');
    assert.match(find, /aria-keyshortcuts="Control\+k Meta\+k"/);
    assert.match(find, /aria-description="Find actions, conversations and saved outputs"/);
    assert.match(find, /Find <kbd>⌘\/Ctrl K<\/kbd>/);

    for (const count of [1, 4, 7]) {
      const sources = Array.from({ length: count }, (_, id) => ({ id, domain: `site${id}.example`, kind: 'web' }));
      const strip = renderToStaticMarkup(React.createElement(SourceStrip, { sources, onOpen() {} }));
      assert.doesNotMatch(strip.match(/^<button\b[^>]*>/)[0], /aria-label=/, 'source domains remain part of the name');
      assert.match(strip, new RegExp(`aria-description="Show all ${count} sources"`));
      assert.match(strip, /<span class="source-stack">/, 'visible domain text stays in the accessibility tree');
      for (const source of sources.slice(0, 4)) assert.ok(strip.includes(source.domain));
      if (count > 4) assert.match(strip, /class="source-more"/);
    }
  } finally {
    await server.close();
  }
});
