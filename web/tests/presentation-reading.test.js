import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { extractOffice } from '../src/lib/office-reader.js';

const relNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const archive = files => zipSync(Object.fromEntries(Object.entries(files).map(([name, xml]) => [name, strToU8(xml)])));
const slide = text => `<p:sld xmlns:p="urn:presentation" xmlns:a="urn:drawing"><p:cSld><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:cSld></p:sld>`;
function deck({ ids = '<p:sldId id="256" r:id="second"/><p:sldId id="257" r:id="first"/>',
  relations = `<Relationship Id="first" Type="${relNS}/slide" Target="slides/slide2.xml"/><Relationship Id="second" Type="${relNS}/slide" Target="slides/slide10.xml"/>`,
  namespace = relNS, extras = {}, list = `<p:sldIdLst>${ids}</p:sldIdLst>` } = {}) {
  return {
    'ppt/presentation.xml': `<p:presentation xmlns:p="urn:presentation" xmlns:r="${namespace}">${list}</p:presentation>`,
    'ppt/_rels/presentation.xml.rels': `<Relationships>${relations}</Relationships>`,
    'ppt/slides/slide2.xml': slide('Closing café'),
    'ppt/slides/slide10.xml': slide('Opening α'),
    ...extras,
  };
}
const read = files => extractOffice(archive(files), 'pptx');

test('PPTX follows manifest order, labels actual positions and excludes orphan slides', () => {
  const result = read(deck({ extras: { 'ppt/slides/slide1.xml': slide('Removed draft') } }));
  assert.match(result.body, /\[Slide 1\]\nOpening α\n\n\[Slide 2\]\nClosing café/);
  assert.doesNotMatch(result.body, /Removed draft|Slide 10/);
  assert.match(result.note, /locally/);
});

test('PPTX relationship IDs are independent of XML attribute order and namespace prefix', () => {
  const files = deck({ ids: '<p:sldId r:id="second" id="256"/><p:sldId r:id="first" id="257"/>' });
  assert.match(read(files).body, /\[Slide 1\]\nOpening α/);
  files['ppt/presentation.xml'] = files['ppt/presentation.xml'].replaceAll('xmlns:r=', 'xmlns:link=').replaceAll('r:id=', 'link:id=');
  assert.match(read(files).body, /\[Slide 1\]\nOpening α/);
  files['ppt/presentation.xml'] = files['ppt/presentation.xml'].replace(relNS, 'http://purl.oclc.org/ooxml/officeDocument/relationships');
  files['ppt/_rels/presentation.xml.rels'] = files['ppt/_rels/presentation.xml.rels'].replaceAll(relNS, 'http://purl.oclc.org/ooxml/officeDocument/relationships');
  assert.match(read(files).body, /\[Slide 1\]\nOpening α/);
});

test('PPTX resolves internal package targets and nonnumeric slide filenames', () => {
  for (const target of ['slides/opening.xml', './slides/opening.xml', '/ppt/slides/opening.xml', '../ppt/slides/opening.xml']) {
    const files = deck({ ids: '<p:sldId id="256" r:id="only"/>',
      relations: `<Relationship Id="only" Type="${relNS}/slide" Target="${target}"/>`,
      extras: { 'ppt/slides/opening.xml': slide('Selected opening') } });
    assert.match(read(files).body, /\[Slide 1\]\nSelected opening/, target);
    assert.doesNotMatch(read(files).body, /Closing café|Opening α/, target);
  }
});

test('PPTX rejects broken, external and ambiguous manifest references instead of guessing', () => {
  const badRelations = [
    '',
    `<Relationship Id="second" Type="${relNS}/slide" Target="slides/missing.xml"/>`,
    `<Relationship Id="second" Type="${relNS}/slide" Target="slides/slide10.xml" TargetMode="External"/>`,
    `<Relationship Id="second" Type="${relNS}/slide" Target="https://example.com/slide.xml"/>`,
    `<Relationship Id="second" Type="${relNS}/slide" Target="//example.com/slide.xml"/>`,
    `<Relationship Id="second" Type="${relNS}/slide" Target="../word/document.xml"/>`,
    `<Relationship Id="second" Type="${relNS}/slide" Target="slides/slide10.xml#fragment"/>`,
    `<Relationship Id="second" Type="${relNS}/slideMaster" Target="slides/slide10.xml"/>`,
    `<Relationship Id="second" Type="${relNS}/slide" Target="slides/slide10.xml"/><Relationship Id="second" Type="${relNS}/slide" Target="slides/slide2.xml"/>`,
  ];
  for (const relations of badRelations) assert.throws(() => read(deck({ relations })), /slide|presentation/i, relations);
  for (const ids of ['<p:sldId id="256"/>', '<p:sldId id="256" r:id="second"/><p:sldId id="257" r:id="second"/>'])
    assert.throws(() => read(deck({ ids })), /slide|presentation/i, ids);
});

test('PPTX does not infer a sequence from a partial, malformed or empty manifest', () => {
  for (const part of ['ppt/presentation.xml', 'ppt/_rels/presentation.xml.rels']) {
    const files = deck();
    delete files[part];
    assert.throws(() => read(files), /part|presentation|slide/i);
  }
  for (const xml of ['<broken>', '<wrong/>', `<p:presentation xmlns:p="urn:presentation"/>`,
    '<!DOCTYPE x [<!ENTITY e "untrusted">]><presentation>&e;</presentation>']) {
    const files = deck();
    files['ppt/presentation.xml'] = xml;
    assert.throws(() => read(files), /XML|presentation|slide|readable/i);
  }
  assert.throws(() => read(deck({ list: '<p:sldIdLst/>' })), /slide|readable/i);
});

test('PPTX ignores custom-show lists and unreferenced broken slide XML', () => {
  const files = deck({ extras: { 'ppt/slides/slide1.xml': '<broken>' } });
  files['ppt/presentation.xml'] = files['ppt/presentation.xml'].replace('</p:presentation>',
    '<p:custShowLst><p:custShow><p:sldLst><p:sld r:id="first"/></p:sldLst></p:custShow></p:custShowLst></p:presentation>');
  assert.match(read(files).body, /\[Slide 1\]\nOpening α\n\n\[Slide 2\]\nClosing café/);
});

test('PPTX retains numeric ordering for existing manifest-free archives and text conventions', () => {
  const files = deck();
  delete files['ppt/presentation.xml'];
  delete files['ppt/_rels/presentation.xml.rels'];
  assert.match(read(files).body, /\[Slide 2\]\nClosing café\n\n\[Slide 10\]\nOpening α/);
});

test('PPTX resolves scoped relationship namespaces and rejects unrelated id attributes', () => {
  const files = deck({ ids: `<p:sldId xmlns:ref="${relNS}" id="256" ref:id="second"/>` });
  assert.match(read(files).body, /\[Slide 1\]\nOpening α/);
  for (const ids of [
    '<p:sldId xmlns:r="urn:unrelated" id="256" r:id="second"/>',
    '<p:sldId id="second"/>',
    '<p:sldId id="256" r:id=""/>',
  ]) assert.throws(() => read(deck({ ids })), /slide|presentation/i);
});

test('PPTX rejects repeated source aliases, multiple slide lists and malformed relationships', () => {
  const relations = `<Relationship Id="first" Type="${relNS}/slide" Target="slides/slide10.xml"/><Relationship Id="second" Type="${relNS}/slide" Target="/ppt/slides/slide10.xml"/>`;
  assert.throws(() => read(deck({ relations })), /repeated/);
  assert.throws(() => read(deck({ list: '<p:sldIdLst/><p:sldIdLst/>' })), /slide list/);
  for (const xml of ['<broken>', '<wrong/>', '<!DOCTYPE x [<!ENTITY e "untrusted">]><Relationships>&e;</Relationships>']) {
    const files = deck();
    files['ppt/_rels/presentation.xml.rels'] = xml;
    assert.throws(() => read(files), /XML|presentation|slide/i);
  }
});

test('PPTX metadata remains subject to XML and expanded archive limits', () => {
  for (const part of ['ppt/presentation.xml', 'ppt/_rels/presentation.xml.rels']) {
    const files = deck();
    files[part] = ' '.repeat(4_000_001);
    assert.throws(() => read(files), /limit/);
  }
  const files = deck();
  for (let i = 20; i < 25; i++) files[`ppt/slides/slide${i}.xml`] = ' '.repeat(3_999_999);
  assert.throws(() => read(files), /limit/);
});

test('PPTX preserves rich slide text, blank positions, XML entities and URI-escaped names', () => {
  const files = deck({ relations: `<Relationship Id="second" Type="${relNS}/slide" Target="slides/intro%20one.xml"/><Relationship Id="first" Type="${relNS}/slide" Target="slides/slide2.xml"/>`,
    extras: { 'ppt/slides/intro one.xml': '<p:sld xmlns:p="urn:presentation" xmlns:a="urn:drawing"><a:p><a:r><a:t>Budget &amp; café: $25</a:t></a:r><a:r><a:t> — α²</a:t></a:r></a:p><a:p><a:r><a:t>SUM(A1:A2) | **literal**</a:t></a:r></a:p></p:sld>',
      'ppt/slides/slide2.xml': '<p:sld xmlns:p="urn:presentation"/>' } });
  assert.match(read(files).body, /\[Slide 1\]\nBudget & café: \$25 — α²\nSUM\(A1:A2\) \| \*\*literal\*\*\n\n\[Slide 2\]/);
  // Extraction errors do not poison a later independent document read.
  assert.throws(() => read(deck({ relations: '' })), /slide/);
  assert.match(read(files).body, /Budget & café/);
});
