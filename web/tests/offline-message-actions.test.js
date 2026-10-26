import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

test('reply recovery controls reflect connection state without disabling local actions', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  try {
    const { Message } = await server.ssrLoadModule('/src/components/Message.jsx');
    const cases = [
      [{}, ['Try again']],
      [{ failed: true, errorKind: 'offline', note: 'Connection unavailable.' }, ['Try again']],
      [{ failed: true, errorKind: 'busy', note: 'Please retry.' }, ['Try again']],
      [{ interrupted: true, note: 'Partial answer retained.' }, ['Continue from here', 'Start over']],
      [{ stopped: true }, ['Continue', 'Try again']],
      [{ truncated: true }, ['Continue', 'Try again']],
    ];
    for (const phone of [false, true]) for (const offline of [false, true]) {
      for (const [state, labels] of cases) {
        const html = renderToStaticMarkup(React.createElement(Message, {
          message: { id: 'reply', role: 'assistant', content: 'Original answer.', ...state },
          isLast: true, busy: false, live: false, phone, offline, onAction() {},
        }));
        const buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
          .map(([, attrs, body]) => ({ attrs, text: body.replace(/<[^>]*>/g, '').trim() }));
        for (const label of labels) {
          const button = buttons.find(button => button.text === label || button.attrs.includes(`aria-label="${label}"`));
          assert.ok(button, `${label} remains visible`);
          assert.equal(/\bdisabled=""/.test(button.attrs), offline, `${label}: phone=${phone}, offline=${offline}`);
        }
        const copy = buttons.find(button => button.text === 'Copy' || button.attrs.includes('aria-label="Copy"'));
        assert.ok(copy);
        assert.doesNotMatch(copy.attrs, /\bdisabled=/, 'copy stays available offline');
        assert.ok(html.includes('Original answer.'), 'answer text remains intact');
      }
    }
    for (const errorKind of ['auth', 'limit']) {
      const html = renderToStaticMarkup(React.createElement(Message, {
        message: { id: 'reply', role: 'assistant', content: 'Original answer.', failed: true, errorKind },
        isLast: true, offline: true, onAction() {},
      }));
      const recovery = html.match(/<div class="message-error"[\s\S]*?<button\b([^>]*)>/);
      assert.ok(recovery);
      assert.doesNotMatch(recovery[1], /\bdisabled=/, 'sign-in and local carry-over keep their existing behavior');
    }
  } finally {
    await server.close();
  }
});
