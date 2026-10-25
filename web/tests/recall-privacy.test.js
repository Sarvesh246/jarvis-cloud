import test from 'node:test';
import assert from 'node:assert/strict';
import { recalledExcerpts, suppresses } from '../server/recall-store.js';
import { memoryNote, withMemory } from '../server/memory.js';

const prefix = Array.from({length: 45}, (_, i) => `background${i}`).join(' ');

test('forgotten facts are suppressed beyond the first 32 distinct excerpt words', () => {
  assert.equal(suppresses(`${prefix}. The project codename is Cedar.`, ['project codename cedar']), true);
  assert.equal(suppresses(`${prefix}. Prefers tea.`, ['prefer tea']), true);
});

test('forgetting retains normalization and existing match thresholds throughout an excerpt', () => {
  assert.equal(suppresses(`${prefix} Preferred COLOUR is violet.`, ['prefer color violet']), true);
  assert.equal(suppresses(`${prefix} project is unrelated.`, ['project codename cedar']), false);
  assert.equal(suppresses(`${prefix} tea.`, ['prefer tea']), true);
  assert.equal(suppresses('project codename cedar', []), false);
  assert.equal(suppresses('ordinary conversation', ['prefer like user']), false);
});

const row = (text, extra={}) => ({chat_id:'cedar', title:'Project meeting', updated:'123',
  excerpts:[{text,role:'user',turn:1}], ...extra});

test('recall checks forgotten facts in titles as well as the excerpt sent to the model', () => {
  assert.deepEqual(recalledExcerpts([row('Project meeting agenda', {title:'Project codename Cedar'})], 'project', ['project codename cedar']), []);
  assert.deepEqual(recalledExcerpts([row(`${prefix} Project codename Cedar.`)], 'project', ['project codename cedar']), []);
});

test('both request-time and latest stored forget lists suppress recalled sources', () => {
  const rows=[row(`${prefix} Project codename Cedar.`), row('A project meeting', {chat_id:'other', forgotten:['project meeting']})];
  assert.deepEqual(recalledExcerpts(rows, 'project', ['project codename cedar']), []);
  assert.equal(recalledExcerpts(rows, 'project').length, 1);
});

test('unrelated excerpts retain source identity, ranking, budgets and input data', () => {
  const rows=[row('Project meeting uses metric units. 🌲 `x` $x^2$ | table |'),
    row('Project meeting later correction.', {chat_id:'later',updated:'124'}),
    row('Unrelated lunch', {title:'Lunch',chat_id:'lunch'})];
  const before=structuredClone(rows);
  const result=recalledExcerpts(rows,'project meeting',['prefer tea']);
  assert.deepEqual(result.map(item=>item.chat), ['later','cedar']);
  assert.equal(result[1].text,rows[0].excerpts[0].text);
  assert.equal(result[1].updated,123);
  assert.deepEqual(rows,before);
  const many=Array.from({length:8},(_,i)=>row('project '+ 'text '.repeat(180),{chat_id:String(i)}));
  const bounded=recalledExcerpts(many,'project');
  assert.ok(bounded.length<=4);
  assert.ok(bounded.reduce((n,item)=>n+item.text.length,0)<=3200);
});

test('malformed optional excerpts cannot discard valid recalled sources', () => {
  const rows=[row('',{excerpts:[null, false, {}, {text:42}, {text:'Project decision',role:'user',turn:4}]}),
    row('',{excerpts:null,chat_id:'empty'})];
  assert.deepEqual(recalledExcerpts(rows,'project').map(item=>item.text),['Project decision']);
});

test('forgotten sources stay out of the actual memory prompt while safe sources survive', async () => {
  const rows=[row(`${prefix} Project codename Cedar.`), row('Project meeting uses metric units.',{chat_id:'safe',title:'Units'})];
  const input={conversationId:'current',messages:[{role:'user',content:'Recall project meeting'}]};
  const memory={enabled:()=>true,forPrompt:async()=>({enabled:true,notes:['Prefers coffee'],recallEnabled:true,forgotten:['project codename cedar']})};
  const output=await withMemory(input,{sub:'account'},memory,async(_sub,query,options)=>recalledExcerpts(rows,query,options.forgotten));
  const prompt=memoryNote(output.memory);
  assert.doesNotMatch(prompt,/Cedar|background/);
  assert.match(prompt,/metric units/);
  assert.match(prompt,/historical data/);
  assert.match(prompt,/Prefers coffee/);
});
