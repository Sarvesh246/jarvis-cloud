import test from 'node:test';
import assert from 'node:assert/strict';
import { answerChoices, audioLinks, fileFormat, measuredUsage, pasteName } from '../src/lib/everyday-ui.js';
import { automaticPresentation } from '../src/lib/automatic-presentation.js';
import { parseRichUI } from '../src/lib/rich-ui.js';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { readFileSync } from 'node:fs';

test('daily presentation recovers evidenced choices and summaries without a visual request', () => {
  const choice = automaticPresentation('A few directions.\n\nWhich would you prefer?\n- A quiet weekend\n- A busy city break', 'Plan a trip');
  assert.equal(choice.block.type, 'question');
  assert.deepEqual(choice.block.options, ['A quiet weekend', 'A busy city break']);
  assert.equal(choice.markdown, 'A few directions.');
  assert.equal(answerChoices('Which options do you prefer?\n- First option\n- Second option').options.length, 2);
  const livePattern = automaticPresentation('What kind of setup would you prefer to begin with—building from scratch, or using a website builder?\n\nConcrete options to consider:\n\n1. **DIY with static files** – create an `index.html` and style it with CSS.\n2. **Use a website builder** – start from a template and customize it.', 'Help me start a personal website.');
  assert.equal(livePattern.block.type, 'question');
  assert.equal(livePattern.block.options.length, 2);
  assert.equal(livePattern.block.options[0], 'DIY with static files');
  assert.equal(livePattern.block.details[0], 'create an index.html and style it with CSS.');
  assert.equal(answerChoices('Which direction do you prefer?\n\nYour options:\n\n1. First direction\n\n2. Second direction').options.length, 2);
  const closingQuestion = answerChoices('One question before anything else: how technical do you want to get?\n\n- **Static site with a generator** — you write Markdown, the tool builds a fast site, and you host it free on GitHub Pages or Netlify. More setup, more control.\n- **No-code website builder** — drag-and-drop editor, custom domain included, minimal setup. Less control, but live in an afternoon.\n\nWhich fits you better?');
  assert.equal(closingQuestion.title, 'Which fits you better?');
  assert.equal(closingQuestion.options.length, 2);
  assert.match(closingQuestion.markdown, /how technical/);
  assert.equal(answerChoices('**First option** — one approach.\n\n**Second option** — another approach.\n\nWhich would you choose?').options.length, 2);
  const explained = answerChoices("Here is a question.\n\nWould you prefer to build from scratch or use a website builder?\n\n**Options:**\n\n1. **Build from Scratch:** "+'You control the design and functionality. '.repeat(7)+"\n\n2. **Use a CMS:** "+'Start from a template with less setup. '.repeat(7)+"\n\nLet me know your preference, and we can start.");
  assert.deepEqual(explained.options, ['Build from Scratch', 'Use a CMS']);
  assert.ok(explained.details[0].length > 180);
  assert.match(explained.markdown, /Let me know/);
  const summary = automaticPresentation('Here is the situation.\n\n- **Scope:** A small website\n- **Time:** Three weeks\n- **Team:** Two designers', 'Tell me about the project');
  assert.equal(summary.block.type, 'widgets');
  assert.equal(summary.block.items.length, 3);
  assert.equal(summary.markdown, 'Here is the situation.');
  const gallery = automaticPresentation('![First](https://example.com/first.jpg)\n\n![Second](https://example.com/second.jpg)', 'What do you see?');
  assert.equal(gallery.block.type, 'gallery');
  assert.equal(gallery.markdown, '');
});
test('automatic choices protect literal, plain, code, math and oversized output', () => {
  const content = 'Which would you prefer?\n- First option\n- Second option';
  assert.equal(automaticPresentation(content, 'Plain text only'), null);
  assert.equal(automaticPresentation(content, 'Just the answer'), null);
  assert.notEqual(automaticPresentation(content, 'Show these in a table')?.block?.type, 'question');
  assert.equal(answerChoices('```text\n' + content + '\n```'), null);
  assert.equal(answerChoices('Tasks?\n- [ ] Task one\n- [ ] Task two'), null);
  assert.equal(answerChoices('x'.repeat(12001)), null);
  assert.equal(answerChoices('Options?\n- Same\n- Same'), null);
  assert.equal(answerChoices(Array.from({length:7},(_,i)=>`- Choice ${i+1}`).join('\n')+'\n\nWhich would you prefer?'), null);
  assert.equal(answerChoices('Which source would you choose?\n- [Source one](https://example.com/one)\n- [Source two](https://example.com/two)'), null);
  const citations = '- **First:** [Source](https://example.com/a)\n- **Second:** Some detail\n- **Third:** More detail';
  assert.equal(automaticPresentation(citations, 'Explain'), null);
});
test('media schema refuses unsafe URLs, arbitrary choices, credentials and malformed values', () => {
  const parse = value => parseRichUI(JSON.stringify(value));
  for (const src of ['javascript:alert(1)', 'data:audio/wav;base64,AAAA', 'https://user:pass@example.com/a.mp3', 'https://example.com/page', 'http://example.com/a.mp3'])
    assert.equal(parse({ type: 'audio', src }), null, src);
  assert.ok(parse({ type: 'audio', src: 'https://example.com/audio.mp3?sig=test' }));
  for (const options of [[], ['One'], ['One','One'], ['One',{}], Array(7).fill('a'), ['a', 'x'.repeat(181)]])
    assert.equal(parse({type:'question', options}), null);
  assert.ok(parse({ type:'question', title:'Your choice?', options:['First', 'Second'] }));
  assert.equal(audioLinks('[One](https://example.com/a.mp3) [Again](https://example.com/a.mp3)').length, 1);
  assert.equal(audioLinks('[Bad](https://a:b@example.com/a.mp3)').length, 0);
  for (const example of ['`[Example](https://example.com/a.mp3)`', '    [Example](https://example.com/a.mp3)', '````markdown\n```\n[Example](https://example.com/a.mp3)\n```\n````']) assert.equal(audioLinks(example).length, 0);
});
test('usage figures and file metadata are measured rather than invented', () => {
  assert.deepEqual(measuredUsage({prompt_tokens:120,completion_tokens:30}), {input:120,output:30,total:150});
  for (const usage of [null, {}, {total_tokens:100}, {prompt_tokens:-1,completion_tokens:10}, {prompt_tokens:0,completion_tokens:0}]) assert.equal(measuredUsage(usage), null);
  assert.equal(fileFormat('résumé.pdf'), 'PDF');
  assert.equal(fileFormat('report', 'table'), 'CSV');
  assert.equal(pasteName('# A pasted document\nText'), 'A pasted document');
});
test('deployment policy permits real audio without enabling scripts in artifact previews', () => {
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const policy = config.headers.flatMap(rule => rule.headers).find(header => header.key === 'Content-Security-Policy').value;
  assert.match(policy, /media-src 'self' blob: https:/);
  assert.match(policy, /object-src 'none'/);
  const preview = readFileSync(new URL('../src/components/blocks/InlinePreview.jsx', import.meta.url), 'utf8');
  assert.match(preview, /media-src 'none'/);
  assert.match(preview, /script-src 'none'/);
});
test('actual reply renderer exposes automatic cards, media, artifacts and text fallbacks', async () => {
  const server = await createServer({ server: {middlewareMode:true}, optimizeDeps:{noDiscovery:true}, appType:'custom' });
  try {
    const { Rendered } = await server.ssrLoadModule('/src/components/blocks/Blocks.jsx');
    const { Message } = await server.ssrLoadModule('/src/components/Message.jsx');
    const { UsageMeter, ContextMeter } = await server.ssrLoadModule('/src/components/EverydayUI.jsx');
    const render = (content, options = {}) => renderToStaticMarkup(React.createElement(Rendered, { content, sources:[], onOpen(){}, onAnswer(){}, ...options }));
    const choices = 'Which approach do you prefer?\n- A small first release\n- The complete scope';
    assert.match(render(choices), /question-card/);
    assert.doesNotMatch(render(choices, {live:true}), /question-card/);
    assert.doesNotMatch(render(choices, {requestText:'plain text only'}), /question-card/);
    assert.match(render('[Recording](https://example.com/recording.mp3)'), /<audio/);
    assert.doesNotMatch(render('```markdown\n[Example](https://example.com/a.mp3)\n```'), /<audio/);
    assert.match(render('```html\n<h1>Artifact</h1>\n```'), /Web artifact/);
    assert.match(render('```vaelo-ui\n'+JSON.stringify({type:'audio',src:'https://example.com/a.mp3'})+'\n```'), /<audio/);
    assert.match(render('```vaelo-ui\n'+JSON.stringify({type:'question',options:['One','Two']})+'\n```'), /question-card/);
    const math = render('Solve $x^2=4$.', {requestText:'Solve the equation'});
    assert.doesNotMatch(math, /question-card|block-fallback/);
    const html = renderToStaticMarkup(React.createElement(Message, {message:{id:'versions',role:'assistant',content:'Second reply',version:1,versions:[{content:'First reply'},{content:'Second reply'}], context:{turns:3,dropped:2}, usage:{prompt_tokens:200,completion_tokens:50}}, onAction(){}, isLast:true}));
    assert.match(html, /version-tree/);
    assert.match(renderToStaticMarkup(React.createElement(UsageMeter, {usage:{prompt_tokens:200,completion_tokens:50}})), /Reported tokens/);
    assert.match(renderToStaticMarkup(React.createElement(ContextMeter, {context:{turns:3,dropped:2}})), /Earlier messages retained/);
    assert.doesNotMatch(html, /block-fallback/);
  } finally { await server.close(); }
});
