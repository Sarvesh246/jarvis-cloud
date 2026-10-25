import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { extractOffice } from '../src/lib/office-reader.js';
import { composeContent } from '../src/lib/attachments.js';

const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const paragraph = text => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const cell = body => `<w:tc>${body}</w:tc>`;
const row = cells => `<w:tr>${cells}</w:tr>`;
const table = rows => `<w:tbl>${rows}</w:tbl>`;
const packageBytes = files => zipSync(Object.fromEntries(Object.entries(files)
  .map(([name, xml]) => [name, typeof xml === 'string' ? strToU8(xml) : xml])));
const files = (body, parts = {}) => ({
  'word/document.xml': `<w:document xmlns:w="${ns}"><w:body>${body}</w:body></w:document>`, ...parts,
});
const read = (body, parts) => extractOffice(packageBytes(files(body, parts)), 'docx');
const mainText = result => result.body.split('[word/document.xml]\n')[1];

test('DOCX decimal and hexadecimal XML references preserve authored Unicode and whitespace', () => {
  assert.equal(mainText(read(paragraph('caf&#233; &#x6771;&#x4EAC; &#x1F30D;&#9;A&#10;B&#13;C'))),
    'café 東京 🌍\tA\nB\rC');
});

test('DOCX references decode once and CDATA and escaped markup remain literal', () => {
  assert.equal(mainText(read(paragraph('&#38;#10; &amp;#x6771; &amp;amp; &lt;w:tab/&gt; &quot;yes&quot; &apos;no&apos;') +
    paragraph('<![CDATA[&#10; &amp; <w:tab/>]]>'))),
  '&#10; &#x6771; &amp; <w:tab/> "yes" \'no\'\n&#10; &amp; <w:tab/>');
});

test('DOCX inline line breaks and authored hyphens retain their text positions', () => {
  const body = '<w:p><w:r><w:t>First</w:t><w:tab/><w:t>column</w:t><w:cr/>' +
    '<w:t>second</w:t><w:br/><w:t>non</w:t><w:noBreakHyphen/><w:t>breaking</w:t>' +
    '<w:softHyphen/><w:t>word</w:t><w:br w:type="page"/><w:t>last</w:t></w:r></w:p>';
  assert.equal(mainText(read(body)), 'First\tcolumn\nsecond\nnon\u2011breaking\u00adword\nlast');
});

test('DOCX nested tables contribute each cell once in source order', () => {
  const inner = table(row(cell(paragraph('Inner A')) + cell(paragraph('Inner B'))));
  const body = table(row(cell(paragraph('Before') + inner + paragraph('After')) + cell(paragraph('Peer'))) +
    row(cell(paragraph('Bottom')) + cell(paragraph('End'))));
  assert.equal(mainText(read(body)), 'Before\nInner A\tInner B\nAfter\tPeer\nBottom\tEnd');
});

test('DOCX nested tables retain content controls around rows and cells without duplicate descendants', () => {
  const wrap = body => `<w:sdt><w:sdtContent>${body}</w:sdtContent></w:sdt>`;
  const inner = table(wrap(row(wrap(cell(paragraph('Nested unique'))))));
  const body = table(wrap(row(wrap(cell(paragraph('Parent') + inner + paragraph('Tail'))) +
    wrap(cell(paragraph('Sibling'))))));
  assert.equal(mainText(read(body)), 'Parent\nNested unique\nTail\tSibling');
});

test('DOCX deeply nested tables do not multiply extracted text or consume the text limit', () => {
  let body = paragraph('Unique deepest value ' + 'x'.repeat(3000));
  for (let depth = 0; depth < 12; depth++) body = table(row(cell(body)));
  const extracted = mainText(read(body));
  assert.equal(extracted, 'Unique deepest value ' + 'x'.repeat(3000));
});

test('DOCX entities and controls are preserved in separately labelled supporting parts', () => {
  const parts = {
    'word/header1.xml': `<w:hdr xmlns:w="${ns}">${paragraph('Header &#x6771;')}</w:hdr>`,
    'word/footer1.xml': `<w:ftr xmlns:w="${ns}">${paragraph('Footer &#233;')}</w:ftr>`,
    'word/footnotes.xml': `<w:footnotes xmlns:w="${ns}"><w:footnote w:id="1">${paragraph('Footnote &#x1F30D;')}</w:footnote></w:footnotes>`,
    'word/endnotes.xml': `<w:endnotes xmlns:w="${ns}"><w:endnote w:id="1">${paragraph('Endnote &#9;value')}</w:endnote></w:endnotes>`,
  };
  const result = read(paragraph('Main'), parts);
  for (const [name, value] of [['header1', 'Header 東'], ['footer1', 'Footer é'],
    ['footnotes', 'Footnote 🌍'], ['endnotes', 'Endnote \tvalue']])
    assert.ok(result.body.includes(`[word/${name}.xml]\n${value}`));
  assert.ok(result.body.indexOf('[word/document.xml]') < result.body.indexOf('[word/endnotes.xml]'));
});

test('DOCX ordinary paragraphs, rich runs, hyperlinks and simple table output stay unchanged', () => {
  const body = paragraph('  Budget &amp; café  ') + '<w:p><w:r><w:t>Bold </w:t></w:r>' +
    '<w:hyperlink r:id="link" xmlns:r="urn:relationships"><w:r><w:t>link</w:t></w:r></w:hyperlink>' +
    '<w:r><w:tab/><w:t> tail</w:t><w:br/><w:t>$x^2$ `code` | table</w:t></w:r></w:p>' +
    table(row(cell(paragraph('Approved')) + cell(paragraph('18470'))) + row(cell(paragraph('')) + cell(paragraph('Zero'))));
  assert.equal(mainText(read(body)), '  Budget & café  \nBold link\t tail\n$x^2$ `code` | table\nApproved\t18470\n\tZero');
});

test('DOCX corrected text remains inside the existing outbound attachment fence', () => {
  const result = read(paragraph('&#x6771; ```code```') + table(row(cell(paragraph('Before') +
    table(row(cell(paragraph('Nested once'))))))));
  const content = composeContent('Review this file', [{ ...result, name: 'review.docx', kind: 'text', state: 'ready' }]);
  assert.ok(content.startsWith('Review this file\n\nAttached file: review.docx\n````\n'));
  assert.ok(content.endsWith('\n````'));
  assert.equal(content.split('Nested once').length - 1, 1);
  assert.ok(content.includes('東 ```code```'));
});

test('DOCX keeps XML, UTF-8, nesting, empty-content and extracted-size rejection boundaries', () => {
  for (const body of ['<!DOCTYPE w:document><w:document/>', '<w:document>', '<!ENTITY x "bad"><w:document/>'])
    assert.throws(() => extractOffice(packageBytes({ 'word/document.xml': body }), 'docx'), /XML/);
  assert.throws(() => extractOffice(packageBytes({ 'word/document.xml': new Uint8Array([0xff]) }), 'docx'), /encoding|encoded data/i);
  assert.throws(() => read('<w:p><w:r><w:cr/><w:tab/></w:r></w:p>'), /No readable/);
  assert.throws(() => read(paragraph('x'.repeat(158000))), /Too much extracted text/);
  assert.throws(() => read('<w:sdt>'.repeat(70) + paragraph('Deep') + '</w:sdt>'.repeat(70)), /deeply nested/);
});
