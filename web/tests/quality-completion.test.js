import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { extractOffice } from '../src/lib/office-reader.js';
import { sourceExcerpts, historyDigest, relevantDocument, rankExcerpts } from '../shared/context-retrieval.js';
import { visualContextTurn, wireMessage, fitHistory } from '../src/lib/attachments.js';
import { checkAnswer, median, summarize } from '../evaluation/metrics.js';
import { comprehensiveCases } from '../evaluation/comprehensive.js';
import { compareReports } from '../evaluation/compare.js';
import { reviewedExamples } from '../evaluation/training-data.js';
import { createHash } from 'node:crypto';

const archive=files=>zipSync(Object.fromEntries(Object.entries(files).map(([name,xml])=>[name,strToU8(xml)])));
test('DOCX preserves paragraph, table, unicode and source boundaries without running embedded content',()=> {
  const result=extractOffice(archive({'word/document.xml':'<w:document xmlns:w="urn:word"><w:body><w:p><w:r><w:t>Budget &amp; café</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Approved</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>18470</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>'}),'docx');
  assert.match(result.body,/Budget & café/);
  assert.match(result.body,/Approved\t18470/);
  assert.match(result.body,/word\/document.xml/);
});
test('XLSX retains cells, missing columns, formulas, cached values and named sheet order',()=> {
  const result=extractOffice(archive({
    'xl/workbook.xml':'<workbook xmlns:r="urn:rels"><sheets><sheet name="Sales" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/sharedStrings.xml':'<sst><si><t>January</t></si></sst>',
    'xl/worksheets/sheet1.xml':'<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1"><f>SUM(A2:A3)</f><v>-12.5</v></c><c r="D1"/></row></sheetData></worksheet>',
  }),'xlsx');
  assert.match(result.body,/Sheet "Sales"/);
  assert.match(result.body,/A1="January"/);
  assert.match(result.body,/C1="-12.5".*SUM\(A2:A3\).*not calculated/);
  assert.match(result.body,/D1=""/);
  assert.doesNotMatch(result.body,/B1=/);
});
test('PPTX slides use numeric order and reject malformed or hostile XML and zip bombs',()=> {
  const result=extractOffice(archive({'ppt/slides/slide10.xml':'<slide><p><t>Ten</t></p></slide>',
    'ppt/slides/slide2.xml':'<slide><p><t>Two</t></p></slide>'}),'pptx');
  assert.ok(result.body.indexOf('Two')<result.body.indexOf('Ten'));
  for(const xml of ('<!DOCTYPE x [<!ENTITY e "secret">]><document>&e;</document>|<unclosed>').split('|'))
    assert.throws(()=>extractOffice(archive({'word/document.xml':xml}),'docx'));
  assert.throws(()=>extractOffice(archive({'word/document.xml':'x'.repeat(4000001)}),'docx'),/limit/);
});
test('retrieval searches middle and end beyond the former 12000-character prefix',()=> {
  const source='Filler line. '.repeat(6000)+'\nProject codename: MIDDLE-729.\n'+'Other material. '.repeat(3000)+'\nCorrection: current project codename is END-891.';
  const digest=historyDigest([{role:'user',content:source}],'What is the project codename?',5000);
  assert.match(digest,/MIDDLE-729/);
  assert.match(digest,/END-891/);
  const selected=relevantDocument(source,'current project codename',2500);
  assert.match(selected,/END-891/);
  assert.ok(selected.length<=2500);
  for(const match of selected.matchAll(/\[Characters (\d+)-(\d+)\]\n([^]*?)(?=\n\n\[Characters |$)/g))
    assert.equal(match[3],source.slice(Number(match[1])-1,Number(match[2])));
  assert.ok(sourceExcerpts(source,'codename').length<=64);
  const words='ordinary '.repeat(60)+'rare_identifier';
  assert.equal(rankExcerpts([{text:words}],'rare_identifier').length,1);
});
test('history refitting retains corrections from turns displaced by the digest itself',()=> {
  const list=['Project codename OLD-123.','irrelevant','irrelevant',
    'Correction: current project codename is DIAMOND-729.','filler','filler',
    'What is the project codename?'].map(content=>({role:'user',content}));
  const result=fitHistory(list,{chars:8000,count:4});
  assert.equal(result.recalled,true);
  assert.match(result.messages[0].content,/DIAMOND-729/);
  assert.ok(result.messages.length<=4);
});
test('visual follow-ups include actual preceding images only for relevant turns',()=> {
  const messages=[{role:'user',content:'See this.',attachments:[{id:'image',kind:'image',name:'shapes.png'}]},
    {role:'assistant',content:'Three shapes.'},{role:'user',content:'Count the red shapes in that image again.'}];
  assert.equal(visualContextTurn(messages),0);
  const wired=wireMessage(messages[0],{latest:true,images:new Map([['image','data:image/png;base64,AAAA']])});
  assert.equal(wired.content[1].type,'image_url');
  assert.match(wireMessage(messages[0],{latest:true}).content,/original pixels unavailable/);
  messages[2].content='Translate good morning into French.';
  assert.equal(visualContextTurn(messages),2);
});
test('benchmark grading rejects extra punctuation, invalid JSON and degraded passes and uses conventional median',()=> {
  assert.equal(checkAnswer('391.',{exact:'391'}).passed,false);
  assert.equal(checkAnswer('```json\n{"a":1}\n```',{json:true}).passed,false);
  assert.equal(checkAnswer('{"a":1}',{jsonEquals:{a:1}}).passed,true);
  assert.equal(checkAnswer('{"a":2}',{jsonEquals:{a:1}}).passed,false);
  assert.equal(checkAnswer('one two three',{maxWords:2}).passed,false);
  assert.equal(median([1,9]),5);
  const stats=summarize([{outcome:'complete',degraded:true,quality:{passed:true},total_ms:1},
    {outcome:'complete',quality:{passed:true},total_ms:9}]);
  assert.equal(stats.total.median_ms,5);
  assert.equal(stats.automated_passes,1);
});

test('comprehensive evaluation has 200 reproducible synthetic cases and independent holdout variants',()=> {
  const cases=comprehensiveCases();
  assert.equal(cases.length,200);
  assert.equal(new Set(cases.map(item=>item.id)).size,200);
  assert.deepEqual(cases,comprehensiveCases());
  assert.notDeepEqual(cases,comprehensiveCases(9821));
  assert.ok(new Set(cases.map(item=>item.family)).size>=12);
  assert.ok(cases.every(item=>item.review&&item.messages.at(-1).role==='user'));
});

test('speed experiments require matched cases, revisions and independent semantic review',()=> {
  const answer='391',hash=createHash('sha256').update(answer).digest('hex');
  const rows=Array.from({length:30},(_,i)=>({case:`arithmetic-${i}`,capability:'routing',outcome:'complete',
    total_ms:100,answer_sha256:hash,quality:{passed:true},
    review:{method:'human',answer_sha256:hash,correct:true,complete:true,grounded:true,constraints:true}}));
  const before={environment:'https://example.com',mode:'signed-in',case_set_sha256:'same',deployed_revision:'a'.repeat(40),backend_revision:'a'.repeat(40),rows};
  const after={...before,deployed_revision:'b'.repeat(40),rows:rows.map(row=>({...row,total_ms:50}))};
  assert.equal(compareReports(before,after).eligible,true);
  assert.equal(compareReports(before,after).cohorts[0].speed_change_percent,50);
  const wrong={...after,rows:after.rows.map(row=>({...row,review:{...row.review,correct:false}}))};
  assert.equal(compareReports(before,wrong).eligible,false);
  assert.equal(compareReports(before,{...after,rows:after.rows.slice(0,2)}).eligible,false);
  assert.equal(compareReports(before,{...after,deployed_revision:'unverified'}).eligible,false);
  const item={id:'arithmetic-0',messages:[{role:'user',content:'17*23'}]};
  const record={...rows[0],answer_for_review:answer,answer_chars:answer.length};
  assert.equal(reviewedExamples({rows:[record]},[item]).examples.length,1);
  assert.equal(reviewedExamples({rows:[{...record,answer_for_review:'392'}]},[item]).examples.length,0);
});
