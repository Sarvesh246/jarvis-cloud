import test from 'node:test';
import assert from 'node:assert/strict';
import { schemaValue, prepareInput, valueForType, updateValue, validateInput, readWorkCache, writeWorkCache, requestWork, importWork, draftMatches, refreshWorkReferences } from '../src/lib/workroom.js';
import { CAPABILITIES } from '../shared/capabilities.js';

test('deleting selected work detaches only matching chats and updates preserve other contexts',()=>{
  const first={id:'a',workContext:{id:'work-a',revision:'old',scope:'personal',title:'A'}};
  const second={id:'b',workContext:{id:'work-b',revision:'other',scope:'client',title:'B'}};
  const removed=refreshWorkReferences([first,second],{id:'work-a',deleted:true},10);
  assert.equal(removed[0].workContext,undefined);assert.equal(removed[1],second);
  assert.ok(first.workContext);
  const edited=refreshWorkReferences([first,second],{id:'work-a',revision:'new',scope:'work',title:'Revised'},11);
  assert.equal(edited[0].workContext.revision,'new');assert.equal(edited[1],second);
});

test('schema defaults leave required scalar fields unanswered and lists empty',()=>{
  const schema={type:'object',properties:{number:{type:'number'},agreed:{type:'boolean'},rows:{type:'array',items:{type:'object'}},note:{type:'string',default:'User chosen'}}};
  assert.deepEqual(schemaValue(schema),{number:'',agreed:'',rows:[],note:'User chosen'});
  assert.equal(valueForType('number'),0); assert.equal(valueForType('boolean'),false);
  assert.ok(CAPABILITIES.every(c=>schemaValue(c.inputSchema) && c.inputSchema.type==='object'));
});
test('schema normalization removes untouched optional nested records, retaining required blanks and explicit zero/false',()=>{
  const schema={type:'object',required:['required'],properties:{required:{type:'string'},count:{type:'number'},enabled:{type:'boolean'},optional:{type:'object',required:['detail'],properties:{detail:{type:'string'},rows:{type:'array'}}}}};
  const empty=schemaValue(schema);
  assert.deepEqual(prepareInput(schema,empty),{required:''});
  assert.deepEqual(prepareInput(schema,{...empty,count:0,enabled:false}),{required:'',count:0,enabled:false});
  assert.ok(validateInput(schema,prepareInput(schema,empty)).some(error=>error.includes('Required')));
});
test('native document proposal keeps source and omits untouched optional observation',()=>{
  const schema=CAPABILITIES.find(c=>c.id===1).inputSchema;
  const input={...schemaValue(schema),contract:{id:'verify',resource:{kind:'document',id:'c:m'},checks:[]},source:{kind:'vaelo-document',conversationId:'c',messageId:'m'}};
  const normalized=prepareInput(schema,input);
  assert.equal(normalized.observation,undefined); assert.equal(normalized.source.messageId,'m'); assert.deepEqual(validateInput(schema,normalized),[]);
});
test('nested updates preserve other records and reject reserved field paths',()=>{
  const original={rows:[{name:'first'},{name:'second'}]};
  const changed=updateValue(original,['rows',1,'name'],'revised');
  assert.equal(changed.rows[0].name,'first');assert.equal(changed.rows[1].name,'revised');assert.equal(original.rows[1].name,'second');
  assert.throws(()=>updateValue({},['__proto__','polluted'],true));assert.equal({}.polluted,undefined);
});
test('client validation catches unknown booleans, fractional integers and invalid enum without rejecting false/zero',()=>{
  const schema={type:'object',required:['count','yes','mode'],properties:{count:{type:'integer'},yes:{type:'boolean'},mode:{type:'string',enum:['one','two']}}};
  assert.deepEqual(validateInput(schema,{count:0,yes:false,mode:'one'}),[]);
  assert.ok(validateInput(schema,{count:1.5,yes:'',mode:'three'}).length>=3);
});
test('offline records remain isolated by account and corrupted cache is ignored',()=>{
  const data=new Map(),storage={getItem:key=>data.get(key),setItem:(key,value)=>data.set(key,value)};
  writeWorkCache('alice',[{id:'alice-only'}],storage);writeWorkCache('bob',[{id:'bob-only'}],storage);
  assert.deepEqual(readWorkCache('alice',storage),[{id:'alice-only'}]);assert.deepEqual(readWorkCache('bob',storage),[{id:'bob-only'}]);assert.deepEqual(readWorkCache(null,storage),[]);
  data.set('vaelo-work:v1:alice',JSON.stringify({account:'bob',records:[{id:'wrong-account'}]}));assert.deepEqual(readWorkCache('alice',storage),[]);
  data.set('vaelo-work:v1:alice','bad JSON');assert.deepEqual(readWorkCache('alice',storage),[]);
});
test('imports become review drafts and discard server authority fields',()=>{
  const [draft]=importWork(JSON.stringify({records:[{id:'old',revision:'old-revision',capabilityId:26,title:'My phrases',scope:'work',input:{text:'mine'},output:{status:'completed'}}]}),CAPABILITIES);
  assert.equal(draft.title,'My phrases');assert.equal(draft.id,undefined);assert.equal(draft.revision,undefined);assert.equal(draft.output,undefined);
  assert.throws(()=>importWork('{invalid',CAPABILITIES));assert.throws(()=>importWork(JSON.stringify({capabilityId:999,input:{}}),CAPABILITIES));
});
test('requests include CSRF and exact revision; conflict is surfaced without retry',async()=>{
  let calls=0;
  await assert.rejects(requestWork({action:'run',id:'one',base:'version-1'},{csrf:'csrf-token',request:async(url,options)=>{
    calls++;assert.equal(url,'/api/work');assert.equal(options.headers['X-CSRF-Token'],'csrf-token');assert.equal(options.credentials,'same-origin');assert.equal(JSON.parse(options.body).base,'version-1');
    return {ok:false,status:409,json:async()=>({error:'Changed elsewhere'})};
  }}),error=>error.status===409&&error.message==='Changed elsewhere');
  assert.equal(calls,1);
});
test('saved-only discussion comparison detects scope and input edits',()=>{
  const record={id:'r',capabilityId:1,title:'Check',scope:'personal',input:{x:1},revision:'v'};
  assert.equal(draftMatches(record,structuredClone(record)),true);
  assert.equal(draftMatches(record,{...record,scope:'client'}),false);assert.equal(draftMatches(record,{...record,input:{x:2}}),false);
});
test('a missing required field is reported once, by its own label',()=>{
  const schema={type:'object',required:['maxCost'],properties:{maxCost:{type:'number',title:'Maximum cost'}}};
  assert.deepEqual(validateInput(schema,{maxCost:''}),['Inputs · Maximum cost is required.']);
});
