import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { extractOffice } from '../src/lib/office-reader.js';

function workbook({ cells = '<c r="A1"><v>1</v></c>', strings, properties = '', styles = true } = {}) {
  return {
    'xl/workbook.xml': `<workbook xmlns:r="urn:rels">${properties}<sheets><sheet name="Values" r:id="sheet"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="sheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': `<worksheet><sheetData><row r="1">${cells}</row></sheetData></worksheet>`,
    ...(strings === undefined ? {} : { 'xl/sharedStrings.xml': `<sst>${strings}</sst>` }),
    ...(styles ? { 'xl/styles.xml': '<styleSheet><cellXfs><xf numFmtId="14"/></cellXfs></styleSheet>' } : {}),
  };
}
const read = options => extractOffice(zipSync(Object.fromEntries(Object.entries(workbook(options))
  .map(([name, xml]) => [name, strToU8(xml)]))), 'xlsx');
const value = (body, address) => JSON.parse(body.match(new RegExp(`${address}=("(?:[^"\\\\]|\\\\.)*")`))[1]);

test('XLSX shared strings keep base text separate from phonetic pronunciation hints', () => {
  const { body } = read({ cells: '<c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c>',
    strings: '<si><t>東京</t><rPh sb="0" eb="2"><t>トウキョウ</t></rPh></si>' +
      '<si><r><t>大</t></r><r><t>阪</t></r><rPh sb="0" eb="2"><t>オオサカ</t></rPh></si>' });
  assert.equal(value(body, 'A1'), '東京');
  assert.equal(value(body, 'C1'), '大阪');
  assert.doesNotMatch(body, /トウキョウ|オオサカ/);
});

test('XLSX inline strings preserve rich runs, whitespace and Unicode without phonetic text', () => {
  const { body } = read({ cells: '<c r="A1" t="inlineStr"><is><r><t xml:space="preserve">  café &amp; </t></r>' +
    '<r><t>東京 🌍</t></r><rPh sb="9" eb="11"><t>トウキョウ</t></rPh></is></c>' });
  assert.equal(value(body, 'A1'), '  café & 東京 🌍');
});

test('XLSX text extraction stays inside authored string and rich-run text children', () => {
  const { body } = read({ cells: '<c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr">' +
    '<is><t>Inline</t><extLst><ext><t>unrelated inline</t></ext></extLst></is><extLst><t>cell metadata</t></extLst></c>',
    strings: '<si><r><rPr><ext><t>run metadata</t></ext></rPr><t>Shared</t></r>' +
      '<extLst><ext><t>unrelated shared</t></ext></extLst></si>' });
  assert.equal(value(body, 'A1'), 'Shared');
  assert.equal(value(body, 'B1'), 'Inline');
  assert.doesNotMatch(body, /unrelated|metadata/);
});

test('XLSX prefixed strings and multiple pronunciation runs preserve base-text order', () => {
  const { body } = read({ cells: '<c r="A1" t="s"><v>0</v></c>',
    strings: '<x:si xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<x:r><x:t>東</x:t></x:r><x:rPh sb="0" eb="1"><x:t>トウ</x:t></x:rPh>' +
      '<x:r><x:t>京</x:t></x:r><x:rPh sb="1" eb="2"><x:t>キョウ</x:t></x:rPh></x:si>' });
  assert.equal(value(body, 'A1'), '東京');
});

test('XLSX inline and shared strings retain tabs, line breaks, entities and escaped quotation marks', () => {
  const xml = '<r><t xml:space="preserve"> &quot;café&quot;&#9;</t></r><r><t>α&#10;β &amp; 東京 </t></r>';
  const { body } = read({ cells: '<c r="A1" t="s"><v>0</v></c>' +
    `<c r="B1" t="inlineStr"><is>${xml}</is></c>`, strings: `<si>${xml}</si>` });
  assert.equal(value(body, 'A1'), ' "café"\tα\nβ & 東京 ');
  assert.equal(value(body, 'B1'), value(body, 'A1'));
});

test('XLSX XML references decode once without changing literal references, CDATA or markup', () => {
  const { body } = read({ cells: '<c r="A1" t="inlineStr"><is><t>&#x1F30D;&#128; &amp;#10; &amp;amp; &lt;b&gt;</t></is></c>' +
    '<c r="B1" t="inlineStr"><is><t><![CDATA[&#10; &amp; <raw>]]></t></is></c>' +
    '<c r="C1" t="str"><f>&quot;&#x6771;&quot;</f><v>&#x6771;</v></c>' });
  assert.equal(value(body, 'A1'), '🌍\u0080 &#10; &amp; <b>');
  assert.equal(value(body, 'B1'), '&#10; &amp; <raw>');
  assert.equal(value(body, 'C1'), '東');
  assert.match(body, /formula .*東.*cached value, not calculated here/);
});

test('XLSX phonetic-only records do not fabricate readable cell content', () => {
  for (const options of [
    { cells: '<c r="A1" t="s"><v>0</v></c>', strings: '<si><rPh sb="0" eb="1"><t>hint</t></rPh></si>' },
    { cells: '<c r="A1" t="inlineStr"><is><rPh sb="0" eb="1"><t>hint</t></rPh></is></c>' },
  ]) assert.throws(() => read(options), /No readable/);
});

test('XLSX accepts both XML true spellings for the 1904 date system and keeps serials unchanged', () => {
  for (const date1904 of ['1', 'true']) {
    const { body } = read({ properties: `<workbookPr date1904="${date1904}"/>`, cells: '<c r="A1" s="0"><v>45292.5</v></c>' });
    assert.match(body, /Date system: 1904/);
    assert.equal(value(body, 'A1'), '45292.5');
    assert.match(body, /0: number format 14/);
  }
  for (const properties of ['', '<workbookPr/>', '<workbookPr date1904="0"/>', '<workbookPr date1904="false"/>'])
    assert.match(read({ properties }).body, /Date system: 1900/);
});

test('XLSX shared formula followers retain cached results without inventing an equals-only expression', () => {
  const { body } = read({ cells: '<c r="A1"><f t="shared" si="0" ref="A1:A3">B1*2</f><v>6</v></c>' +
    '<c r="A2"><f t="shared" si="0"/><v>10</v></c><c r="A3"><f t="shared" si="0"/></c>' });
  assert.match(body, /A1="6" \[formula "=B1\*2"; cached value, not calculated here\]/);
  assert.match(body, /A2="10" \[formula text unavailable; shared group "0"; cached value, not calculated here\]/);
  assert.match(body, /A3="" \[formula text unavailable; shared group "0"; cached value unavailable\]/);
  assert.doesNotMatch(body, /formula "="/);
});

test('XLSX empty ordinary and data-table formula records explicitly mark missing expressions', () => {
  const { body } = read({ cells: '<c r="A1"><f/><v>0</v></c><c r="B1"><f t="dataTable" ref="B1:B3"/><v>42</v></c>' });
  assert.match(body, /A1="0" \[formula text unavailable; cached value, not calculated here\]/);
  assert.match(body, /B1="42" \[formula text unavailable; cached value, not calculated here\]/);
  assert.doesNotMatch(body, /formula "="/);
});

test('XLSX ordinary cached formulas, empty caches, errors, booleans and strings keep their existing meaning', () => {
  const { body } = read({ cells: '<c r="A1"><f>SUM(B1:B3)</f><v>-12.50</v></c>' +
    '<c r="B1" t="b"><v>0</v></c><c r="C1" t="e"><v>#DIV/0!</v></c>' +
    '<c r="D1" t="str"><f>IF(1,&quot;&quot;,&quot;x&quot;)</f><v/></c>' +
    '<c r="E1" t="inlineStr"><is><t>literal =1+1; ```; $x$</t></is></c>', styles: false });
  assert.match(body, /A1="-12.50" \[formula "=SUM\(B1:B3\)"; cached value, not calculated here\]/);
  assert.match(body, /B1="0" \[boolean\]/);
  assert.equal(value(body, 'C1'), '#DIV/0!');
  assert.match(body, /D1="" \[formula .*cached value, not calculated here\]/);
  assert.equal(value(body, 'E1'), 'literal =1+1; ```; $x$');
  assert.doesNotMatch(body, /Date system:/);
});

test('XLSX missing shared values and oversized extracted text still fail safely', () => {
  assert.throws(() => read({ cells: '<c r="A1" t="s"><v>1</v></c>', strings: '<si><t>only</t></si>' }), /missing/);
  assert.throws(() => read({ cells: '<c r="A1" t="inlineStr"><is><t>' + 'a'.repeat(158001) + '</t></is></c>' }), /Too much/);
  assert.equal(value(read({}).body, 'A1'), '1');
});

test('XLSX numeric-reference decoding retains XML and archive safety boundaries', () => {
  const packageBytes = parts => zipSync(Object.fromEntries(Object.entries(parts).map(([name, xml]) =>
    [name, typeof xml === 'string' ? strToU8(xml) : xml])));
  for (const xml of ['<!DOCTYPE sst [<!ENTITY source SYSTEM "file:///private">]><sst>&source;</sst>',
    '<sst><si><t>unclosed</si></sst>']) {
    const parts = workbook({ cells: '<c r="A1" t="s"><v>0</v></c>' });
    parts['xl/sharedStrings.xml'] = xml;
    assert.throws(() => extractOffice(packageBytes(parts), 'xlsx'), /XML/);
  }
  const parts = workbook();
  parts['xl/worksheets/sheet1.xml'] = new Uint8Array([0xc3, 0x28]);
  assert.throws(() => extractOffice(packageBytes(parts), 'xlsx'), /encoded data|encoding/i);
  parts['xl/worksheets/sheet1.xml'] = 'a'.repeat(4_000_001);
  assert.throws(() => extractOffice(packageBytes(parts), 'xlsx'), /limit/);
  assert.equal(value(read({ cells: '<c r="A1" t="inlineStr"><is><t>&amp;copy; &amp;#x6771;</t></is></c>' }).body, 'A1'),
    '&copy; &#x6771;');
});
