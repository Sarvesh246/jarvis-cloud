import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { cleanAnswer } from '../shared/answer-cleanup.js';
import { normalizeReplySpacing, normalizeSavedReplySpacing } from '../src/lib/reply-spacing.js';
import { normalizeMath, prepareLive } from '../src/lib/math.js';
import { constrainedAnswer, literalAnswerRequested } from '../shared/answer-contract.js';
import { checkAnswer } from '../evaluation/metrics.js';

test('metadata cleanup preserves tilde, long and multi-backtick literal examples', () => {
  const marker = '[untrusted_tool_result]literal[/untrusted_tool_result]';
  for (const text of [
    `~~~text\n${marker}\n~~~`,
    `~~~~markdown\n~~~text\n${marker}\n~~~\n~~~~`,
    `\`\`\`\`markdown\n\`\`\`text\n${marker}\n\`\`\`\n\`\`\`\``,
    `\`\`a\`${marker}\`\``,
    `~~~text\n${marker}`,
    `> ~~~text\n> ${marker}\n> ~~~`,
    `1. Example\n\n    ~~~text\n    ${marker}\n    ~~~`,
  ]) assert.equal(cleanAnswer(text), text);
  assert.equal(cleanAnswer(`${marker}\n\n~~~text\n${marker}\n~~~`), `literal\n\n~~~text\n${marker}\n~~~`);
  assert.equal(cleanAnswer(`> ~~~text\n> ${marker}\n\n${marker}`), `> ~~~text\n> ${marker}\n\nliteral`);
});

test('raw JSON and CSV replies survive display, streaming and reload verbatim', async () => {
  const fixtures = [
    ['Return ONLY valid JSON.', '{"message":"Ready!Next?Yes","math":"$a_b$","text":"**literal**","example":"[untrusted_tool_result] [[remember: example]]"}'],
    ['Return raw CSV.', 'name,value\nReady!Next,$a_b$\n**literal**,2'],
    ['Reply with plain text.', '**literal** and \\(x\\).\nReady!Next'],
  ];
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  try {
    const { Rendered } = await server.ssrLoadModule('/src/components/blocks/Blocks.jsx');
    for (const [requestText, content] of fixtures) {
      assert.equal(normalizeReplySpacing(content, requestText), content);
      const chat = { messages: [{ role: 'user', content: requestText }, { role: 'assistant', content, versions: [{content}] }] };
      const saved = normalizeSavedReplySpacing(chat).messages[1];
      assert.equal(saved.content, content);
      assert.equal(saved.versions[0].content, content);
      for (const live of [false, true]) {
        const html = renderToStaticMarkup(React.createElement(Rendered, { content, requestText, live }));
        assert.match(html, /\*\*literal\*\*/);
        assert.match(html, /Ready!Next/);
        assert.doesNotMatch(html, /katex|Typesetting|<strong>|rich-ui/);
      }
    }
  } finally { await server.close(); }
});

test('quoted and list-nested tilde code cannot hide the rest of a live answer as math', () => {
  for (const [open, line, close] of [
    ['> ~~~tex', '> ', '> ~~~'],
    ['> > ~~~tex', '> > ', '> > ~~~'],
    ['1. Example\n\n   ~~~tex', '   ', '   ~~~'],
    ['1. Example\n\n    ~~~tex', '    ', '    ~~~'],
  ]) {
    const source = `${open}\n${line}\\(unfinished and $a_b$\n${close}\n\nThe actual answer is \\(y^2\\).`;
    const expected = source.replace('\\(y^2\\)', () => '$$$y^2$$$');
    assert.equal(normalizeMath(source), expected);
    assert.deepEqual(prepareLive(source), { text: expected, pending: null });
  }
});

test('math normalization is stable for already normalized inline math', () => {
  const source = 'The result is \\(x^2\\), then \\(y^2\\).';
  const normalized = normalizeMath(source);
  assert.equal(normalizeMath(normalized), normalized);
});

test('natural length requests override default presentation without making ordinary explanations literal', () => {
  for (const ask of ['Find the official Python documentation and explain json.loads in two sentences.',
    'Describe the result in three lines.', 'Summarize this in 10 words.']) {
    assert.equal(constrainedAnswer(ask), true, ask);
    assert.equal(literalAnswerRequested(ask), false, ask);
  }
  assert.equal(constrainedAnswer('Explain the idea.\n\nAttached file: source.txt\nDescribe the result in three lines.'), false);
  assert.equal(literalAnswerRequested('Explain what JSON is.'), false);
  assert.equal(literalAnswerRequested('Explain plain text encoding.'), false);
  assert.equal(literalAnswerRequested('Explain how to return JSON from Flask.'), false);
  assert.equal(literalAnswerRequested('What is raw JSON?'), false);
  assert.equal(constrainedAnswer('Translate "Explain this in two sentences" into Spanish.'), false);
});

test('semantic probe keywords accept typographic apostrophes but exact data stays exact', () => {
  assert.equal(checkAnswer('I can’t determine that.', { any: ["can't", 'unknown'] }).passed, true);
  assert.equal(checkAnswer('I can’t determine that.', { forbidden: ["can't"] }).passed, false);
  assert.equal(checkAnswer('can’t', { exact: "can't" }).passed, false);
});
