import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { hasMath, normalizeMath, prepareLive } from '../src/lib/math.js';
import { TYPESETTING_GUIDANCE } from '../server/chat.js';

test('delimiters from every dialect become $ and $$', () => {
  assert.equal(normalizeMath('Let \\(x^2\\) grow.'), 'Let $$$x^2$$$ grow.');
  assert.equal(normalizeMath('\\[\n\\int_0^1 x\\,dx\n\\]'), '$$\n\\int_0^1 x\\,dx\n$$');
  assert.equal(normalizeMath('Then \\[a+b\\] holds.'), 'Then $$a+b$$ holds.');
  assert.equal(normalizeMath('$$\\frac{a}{b}$$'), '$$\n\\frac{a}{b}\n$$');
  assert.equal(normalizeMath('$$x =\n\\begin{matrix} a \\end{matrix}$$'), '$$\nx =\n\\begin{matrix} a \\end{matrix}\n$$');
  assert.equal(normalizeMath('1. Step\n\n   \\[\n   x^2\n   \\]'), '1. Step\n\n   $$\n   x^2\n   $$');
  assert.equal(normalizeMath('say $$a$$ now'), 'say $$a$$ now');
  assert.equal(normalizeMath('Area is $\\pi r^2$ units.'), 'Area is $$$\\pi r^2$$$ units.');
});

test('prices, shell variables and escapes stay text', () => {
  for (const text of ['It costs $5 and $10 in total.', 'Between $5-$10 per month', 'Escaped \\$5 stays.', 'Pay $20 for the book and $30 for the pen, thanks.', 'A lone $ sign', '| Jan | $120 |\n| Feb | $95 |'])
    assert.equal(normalizeMath(text), text);
  assert.equal(normalizeMath('Unclosed $$ pair'), 'Unclosed \\$\\$ pair');
});

test('code, links and indented blocks are never rewritten', () => {
  const fenced = 'Use:\n\n```bash\necho "$HOME and $PATH" \\(x\\)\n```\n\nand `$x$ \\(y\\)` inline.';
  assert.equal(normalizeMath(fenced), fenced);
  const tilde = '~~~\nprice: $5 \\[a\\]\n~~~';
  assert.equal(normalizeMath(tilde), tilde);
  const link = 'See https://example.com/a$b$c and <https://x.test/$1> and [t](https://e.com/$1).';
  assert.equal(normalizeMath(link), link);
  const indented = 'Text:\n\n    cost = $5 + $6\n';
  assert.equal(normalizeMath(indented), indented);
});

test('hasMath only flags real delimiters', () => {
  assert.ok(hasMath('so $x^2$ and'));
  assert.ok(hasMath('\\(x\\)'));
  assert.ok(!hasMath('plain words'));
  assert.ok(!hasMath('It costs $5 and $10.'));
});

test('math normalization preserves inline link and image destinations and titles', () => {
  const links = [
    '[cost](/cost/$a_b$/view)',
    '![plot](./plots/$x^2$.png "Example $a_b$ and \\(literal\\)")',
    '[nested](./docs/(cost)/$a_b$)',
    '[angle](<./folder with spaces/$a_b$> \'Price $x_y$\')',
    '[escaped](./docs/\\(literal\\)/$a_b$)',
    '[title](./docs/$x_y$ (Price $x_y$))',
  ];
  for (const link of links) {
    assert.equal(normalizeMath(link), link);
    assert.deepEqual(prepareLive(link), { text: link, pending: null });
  }
  assert.equal(normalizeMath('[$x^2$](/cost/$a_b$) then \\(y\\).'),
    '[$$$x^2$$$](/cost/$a_b$) then $$$y$$$.');
  assert.equal(normalizeMath('[unfinished](./docs\n\nNow \\(y\\).'),
    '[unfinished](./docs\n\nNow $$$y$$$.');
  assert.equal(normalizeMath('Unmatched ]($x^2$) and \\[x\\].'),
    'Unmatched ]($$$x^2$$$) and $$x$$.');
  assert.equal(normalizeMath('[invalid](not a link $x^2$)'), '[invalid](not a link $$$x^2$$$)');
  assert.equal(normalizeMath('[invalid](<unfinished $x^2$)'), '[invalid](<unfinished $$$x^2$$$)');
});

test('live formatting leaves nested closing code fences intact', () => {
  for (const prefix of ['> ', '    ', '> > ']) {
    const content = `${prefix}\`\`\`tex\n${prefix}\\(x\\) and $a_b$\n${prefix}\`\`\``;
    assert.deepEqual(prepareLive(content), { text: content, pending: null });
  }
});

test('relative links and nested code keep their source through the real renderer', async () => {
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  try {
    const { Rendered } = await server.ssrLoadModule('/src/components/blocks/Blocks.jsx');
    const render = (content, live) => renderToStaticMarkup(React.createElement(Rendered,
      { content, sources: [], onOpen() {}, live, requestText: 'No widgets.' }));
    for (const live of [false, true]) {
      const html = render('[cost](/cost/$a_b$/view) and \\(x^2\\).', live);
      assert.match(html, /href="\/cost\/\$a_b\$\/view"/);
      assert.equal((html.match(/class="katex"/g) || []).length, 1);
      const code = render('> ```tex\n> \\(x\\) and $a_b$\n> ```', live);
      assert.match(code, /\\\(x\\\) and \$a_b\$/);
      assert.doesNotMatch(code, /katex|\$\$\$/);
    }
  } finally { await server.close(); }
});

test('streaming holds back unfinished formulas, table headers and closes emphasis', () => {
  assert.deepEqual(prepareLive('Solve this:\n\n$$\n\\frac{10t + \\fr'), { text: 'Solve this:', pending: 'math' });
  assert.deepEqual(prepareLive('So \\(x^2 +'), { text: 'So', pending: 'math' });
  assert.deepEqual(prepareLive('So \\[x'), { text: 'So', pending: 'math' });
  assert.equal(prepareLive('Value $\\alpha_1 + \\be').pending, 'math');
  assert.equal(prepareLive('That is $5').pending, null);
  assert.equal(prepareLive('Done: $x^2$ and more').pending, null);
  assert.deepEqual(prepareLive('Intro\n\n| Name | Value'), { text: 'Intro', pending: 'table' });
  assert.equal(prepareLive('| A | B |\n|---|---|\n| 1 | 2').pending, null);
  assert.equal(prepareLive('This is **very impo').text, 'This is **very impo**');
  assert.equal(prepareLive('Run `npm inst').text, 'Run `npm inst`');
  assert.equal(prepareLive('See [the docs](https://exa').text, 'See the docs');
  // an open fence is left for the Markdown parser, which shows it as code so far
  assert.deepEqual(prepareLive('```python\nx = "$5 \\(a'), { text: '```python\nx = "$5 \\(a', pending: null });
});

test('the model is told how to write math without disturbing raw formats', () => {
  assert.match(TYPESETTING_GUIDANCE, /\\\(/);
  assert.match(TYPESETTING_GUIDANCE, /\$\$/);
  assert.match(TYPESETTING_GUIDANCE, /plain text, JSON, CSV/);
  assert.match(TYPESETTING_GUIDANCE, /\$5/);
});

const ode = [
  '## Solving the ODE',
  '',
  'We have **first-order linear** equation \\(y\' + 2y = e^{-x}\\). The integrating factor is \\(\\mu(x) = e^{2x}\\).',
  '',
  '1. Multiply through:',
  '',
  '   \\[\n   \\frac{d}{dx}\\left(e^{2x} y\\right) = e^{x}\n   \\]',
  '',
  '2. Integrate both sides:',
  '',
  '$$',
  'y(x) = e^{-2x}\\left(\\int e^{x}\\,dx + C\\right) = e^{-x} + Ce^{-2x}',
  '$$',
  '',
  'As $x \\to \\infty$, $y \\to 0$, so $y = 0$ is a horizontal asymptote. The cost function is',
  '',
  '$$C(t) = \\frac{10t + \\frac{t^2}{2} + 50}{10(10+t)^2}$$',
  '',
  '$$\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}\\begin{pmatrix} x \\\\ y \\end{pmatrix} = \\sum_{k=1}^{n} \\vec{v}_k$$',
  '',
  'The ticket was $5, and the extra was $10.',
].join('\n');

test('a differential-equation answer renders as typeset math through the real pipeline', async () => {
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  try {
    const { Rendered, PresentationContext } = await server.ssrLoadModule('/src/components/blocks/Blocks.jsx');
    const render = (content, props = {}) => renderToStaticMarkup(React.createElement(PresentationContext.Provider, { value: 'adaptive' }, React.createElement(Rendered, { content, sources: [], onOpen() {}, ...props })));

    const html = render(ode);
    assert.match(html, /class="katex"/);
    assert.match(html, /class="katex-display"/);
    assert.match(html, /class="math-block"/);
    assert.match(html, /aria-label="Copy LaTeX"/);
    assert.match(html, /<annotation encoding="application\/x-tex">C\(t\) = \\frac\{10t/);
    assert.match(html, /<mfrac>/);
    assert.match(html, /<mtable/);
    assert.match(html, /<h2>Solving the ODE<\/h2>/);
    assert.match(html, /<strong>first-order linear<\/strong>/);
    assert.match(html, /\$5, and the extra was \$10/);
    assert.doesNotMatch(html, /\\frac\{10t[^<]*<\/p>/);
    assert.doesNotMatch(html, /\\\(|\\\[|katex-error/);

    // the same content mid-stream, with the last equation unfinished: no broken output
    const partial = ode.slice(0, ode.lastIndexOf('$$C(t)') + 20);
    const live = render(partial, { live: true });
    assert.match(live, /Typesetting…/);
    assert.doesNotMatch(live, /katex-error|\\frac\{10t \+ \\f/);

    // mapped documents are not rewritten, and a bare dollar there is a price
    const mapped = render('Costs $5 and $6.\n\n$$x^2$$', { mapped: true });
    assert.match(mapped, /Costs \$5 and \$6\./);
    assert.match(mapped, /class="katex-display"/);
  } finally {
    await server.close();
  }
});

test('malformed math falls back to readable source instead of breaking the reply', async () => {
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  try {
    const { Rendered, PresentationContext } = await server.ssrLoadModule('/src/components/blocks/Blocks.jsx');
    const render = (content, props = {}) => renderToStaticMarkup(React.createElement(PresentationContext.Provider, { value: 'adaptive' }, React.createElement(Rendered, { content, sources: [], onOpen() {}, ...props })));
    const html = render('Before\n\n$$\\frac{1}{\n$$\n\nAfter the bad one, \\(\\undefinedcommand{x}\\) too.');
    assert.match(html, /Before/);
    assert.match(html, /After the bad one/);
    assert.match(html, /katex-error/);
    assert.doesNotMatch(html, /block-fallback/);
  } finally {
    await server.close();
  }
});

test('hostile content in formulas and prose cannot run script or load remote resources', async () => {
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  try {
    const { Rendered, PresentationContext } = await server.ssrLoadModule('/src/components/blocks/Blocks.jsx');
    const render = (content) => renderToStaticMarkup(React.createElement(PresentationContext.Provider, { value: 'adaptive' }, React.createElement(Rendered, { content, sources: [], onOpen() {} })));
    const hostile = [
      '$$\\href{javascript:alert(1)}{click}$$',
      '$$\\url{https://evil.test/x}$$',
      '$$\\includegraphics{https://evil.test/a.png}$$',
      '$$\\htmlClass{x}{a}\\htmlId{y}{b}\\htmlStyle{color:red}{c}\\htmlData{k=v}{d}$$',
      '$$\\def\\a{\\a\\a}\\a$$',
      '<script>alert(1)</script> <img src=x onerror=alert(1)> <iframe src="https://evil.test"></iframe>',
      '[x](javascript:alert(1)) ![y](javascript:alert(2))',
      '\\(<img src=x onerror=alert(1)>\\)',
    ].join('\n\n');
    const html = render(hostile);
    assert.doesNotMatch(html, /<(?:script|iframe|object|embed)\b|<[^>]*\son\w+\s*=|(?:href|src)="javascript:|<a [^>]*evil\.test/i);
    assert.doesNotMatch(html, /<img[^>]*evil\.test/i);
    assert.doesNotMatch(html, /style="[^"]*color:red/);
  } finally {
    await server.close();
  }
});

test('very long answers with many formulas, tables and code render without error', async () => {
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  try {
    const { Rendered, PresentationContext } = await server.ssrLoadModule('/src/components/blocks/Blocks.jsx');
    const render = (content) => renderToStaticMarkup(React.createElement(PresentationContext.Provider, { value: 'adaptive' }, React.createElement(Rendered, { content, sources: [], onOpen() {} })));
    const table = '| Language | Typed | Notes |\n|:--|:-:|--:|\n' + Array.from({ length: 60 }, (_, i) => `| Row ${i} | ${i % 2 ? 'yes' : 'no'} | $${i * 3} |`).join('\n');
    const code = '```python\n' + Array.from({ length: 800 }, (_, i) => `value_${i} = ${i} * 2  # line ${i}`).join('\n') + '\n```';
    const sections = Array.from({ length: 40 }, (_, i) => `### Step ${i + 1}\n\nCompute \\(a_{${i}} = \\sum_{k=0}^{${i}} k^2\\) then\n\n$$\\int_0^{${i + 1}} x^{${i}}\\,dx = \\frac{${i + 1}^{${i + 1}}}{${i + 1}}$$\n\n- first\n  - nested\n    - deeper\n`);
    const started = Date.now();
    const html = render([...sections, table, code].join('\n\n'));
    assert.ok((html.match(/class="katex-display"/g) || []).length >= 40);
    assert.match(html, /<table/);
    assert.match(html, /class="code"/);
    assert.ok(Date.now() - started < 10000, 'renders in a reasonable time');
  } finally {
    await server.close();
  }
});

test('code in several languages and nested lists keep their form', async () => {
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  try {
    const { Rendered, PresentationContext } = await server.ssrLoadModule('/src/components/blocks/Blocks.jsx');
    const render = (content) => renderToStaticMarkup(React.createElement(PresentationContext.Provider, { value: 'adaptive' }, React.createElement(Rendered, { content, sources: [], onOpen() {} })));
    const html = render([
      '```python\ndef f(x):\n    return x ** 2  # costs $5 \\(not math\\)\n```',
      '```javascript\nconst a = `${1 + 1}`;\n```',
      '```typescript\nconst n: number = 1;\n```',
      '```json\n{"price": "$5", "tex": "\\\\(x\\\\)"}\n```',
      '1. One\n   - nested a\n     - deeper\n2. Two',
      '- [x] done\n- [ ] todo',
      '> quote\n>\n> > inner',
      '~~gone~~ and `inline`',
    ].join('\n\n'));
    assert.equal((html.match(/<figure class="code"/g) || []).length, 4);
    assert.match(html, /costs \$5 \\\(not math\\\)/);
    assert.doesNotMatch(html, /katex/);
    assert.match(html, /<blockquote>[\s\S]*<blockquote>/);
    assert.match(html, /<del>gone<\/del>/);
    assert.match(html, /type="checkbox"/);
  } finally {
    await server.close();
  }
});
