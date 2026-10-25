import test from 'node:test';
import assert from 'node:assert/strict';
import { collectSources, sourceKey } from '../src/lib/sources.js';

test('explicit Markdown destinations keep significant trailing punctuation', () => {
  for (const suffix of ['.', ',', ';', ':', '!', '?', '_', '~', '*', '()', '(nested_(part))']) {
    const href = `https://example.com/report${suffix}`;
    const [source] = collectSources(`[Report](${href})`);
    assert.equal(source?.url, href, suffix);
    assert.equal(source?.id, sourceKey(href));
    assert.equal(source?.title, 'Report');
  }
});

test('source lookup uses rendered destinations without sentence trimming or double decoding', () => {
  for (const href of ['https://example.com/report.', 'https://example.com/a_(b_(c))',
    'https://example.com/?a=1&amp;b=2', 'https://example.com/path\\name'])
    assert.equal(sourceKey(href), new URL(href).href.replace(/#.*$/, '').replace(/\/$/, ''));
  assert.notEqual(sourceKey('https://example.com/report.'), sourceKey('https://example.com/report'));
});

test('optional Markdown titles do not erase the visible source label', () => {
  for (const title of ['"Official report"', "'Official report'", '(Official report)', '"A \\"quoted\\" title"']) {
    const [source] = collectSources(`The figures rose [Report](https://example.com/report ${title}).`);
    assert.equal(source?.title, 'Report', title);
    assert.equal(source?.url, 'https://example.com/report', title);
    assert.equal(source?.context, 'The figures rose Report.', title);
  }
});

test('angle destinations, balanced parentheses and escaped delimiters keep exact addresses', () => {
  for (const [text, href] of [
    ['[Nested](https://example.com/a_(b_(c)))', 'https://example.com/a_(b_(c))'],
    ['[Escaped](https://example.com/a\\(b\\)\\!)', 'https://example.com/a(b)!'],
    ['[Space](<https://example.com/a b.> "Title")', 'https://example.com/a%20b.'],
    ['[Angle](<https://example.com/a\\>b>)', 'https://example.com/a%3Eb'],
    ['[A [nested] label](https://example.com/report)', 'https://example.com/report'],
  ]) {
    const [source] = collectSources(text);
    assert.equal(source?.url, href, text);
    assert.equal(source?.id, sourceKey(href), text);
  }
});

test('Markdown character references decode once and never become URL delimiters early', () => {
  for (const [raw, href] of [
    ['a&copy;', 'a%C2%A9'], ['a&colon;b', 'a:b'], ['a&amp;amp;b', 'a&amp;b'],
    ['a&#41;b', 'a)b'], ['a&#x1F4DA;', 'a%F0%9F%93%9A'],
  ]) {
    const [source] = collectSources(`[Read](https://example.com/${raw})`);
    assert.equal(source?.url, `https://example.com/${href}`);
    assert.equal(source?.id, sourceKey(source.url));
  }
});

test('bare links still trim sentence punctuation while explicit and auto links retain it', () => {
  const sources = collectSources('See https://example.com/bare. Then [Report](https://example.com/report.). Finally <https://example.com/auto.>.');
  assert.deepEqual(sources.map(s => s.url), ['https://example.com/bare', 'https://example.com/report.', 'https://example.com/auto.']);
  assert.deepEqual(sources.map(s => s.index), [1, 2, 3]);
});

test('malformed destinations recover to bare links without losing later valid sources', () => {
  for (const broken of ['[bad](https://example.com/first "unfinished', '[bad](<https://example.com/first',
    '[bad](https://example.com/first (unclosed', '['.repeat(10000)]) {
    const sources = collectSources(`${broken}\n\n[Good](https://example.com/good "Title")`);
    assert.equal(sources.at(-1)?.url, 'https://example.com/good');
    assert.equal(sources.at(-1)?.title, 'Good');
  }
});

test('source deduplication preserves established fragment and trailing slash equivalence', () => {
  const sources = collectSources('[1](https://example.com/report#top) [Named](https://example.com/report/ "Title") [Different](https://example.com/report.)');
  assert.equal(sources.length, 2);
  assert.equal(sources[0].title, 'Named');
  assert.equal(sources[0].url, 'https://example.com/report#top');
  assert.equal(sources[1].url, 'https://example.com/report.');
});

test('nested links and URLs inside titles cannot steal another source identity', () => {
  const nested = collectSources('[Outer [Inner](https://example.com/inner)](https://example.com/outer)');
  assert.deepEqual(nested.map(s => [s.url, s.title]), [
    ['https://example.com/inner', 'Inner'], ['https://example.com/outer', ''],
  ]);
  const titled = collectSources('[Read](https://example.com/report "Example https://example.com/title").');
  assert.equal(titled.length, 1);
  assert.equal(titled[0].title, 'Read');
  assert.equal(titled[0].url, 'https://example.com/report');
});

test('finished and streaming renderer citation markers open the exact rendered link', async () => {
  const [{ default: React }, { renderToStaticMarkup }, { createServer }] = await Promise.all([
    import('react'), import('react-dom/server'), import('vite'),
  ]);
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  try {
    const { Rendered } = await server.ssrLoadModule('/src/components/blocks/Blocks.jsx');
    for (const content of [
      '[Report](https://example.com/report.)',
      '[Nested](https://example.com/a_(b_(c)))',
      '[Read](https://example.com/a&copy; "Official title")',
      '[1](<https://example.com/a b.> "Official title")',
    ]) {
      const sources = collectSources(content);
      for (const live of [false, true]) {
        const html = renderToStaticMarkup(React.createElement(Rendered, { content, sources, live, onOpen() {} }));
        assert.ok(html.includes('class="cite-mark"'), content);
        assert.ok(html.includes(`class="cite-open" href="${sources[0].url}"`), content);
        assert.ok(!html.includes('block-fallback'), content);
      }
    }
  } finally { await server.close(); }
});
