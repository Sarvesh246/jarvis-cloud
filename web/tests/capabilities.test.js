import test from 'node:test';
import assert from 'node:assert/strict';
import {historyDigest,rankExcerpts} from '../shared/context-retrieval.js';
import {fitHistory} from '../src/lib/attachments.js';
import {MemoryStore,withMemory,memoryNote} from '../server/memory.js';
import {ChatStore} from '../server/chat-store.js';
import {recallDocument,suppresses} from '../server/recall-store.js';
import {within} from '../server/deadline.js';
import {memoryStorage,reply} from './helpers-storage.js';
import {recallApi} from '../server/recall-api.js';
import {requestIntent,tablePresentation} from '../src/lib/adaptive-ui.js';
import {profileRequest} from '../server/request-profile.js';

test('long conversations recover relevant earlier source quotes within the same input budget',()=>{
  const messages=[{role:'user',content:'Cedar launch codename is MAPLE-731. Budget is 42 units.'}];
  for(let i=0;i<40;i++) messages.push({role:i%2?'user':'assistant',content:'Unrelated discussion '+i+' '+ 'example '.repeat(90)});
  messages.push({role:'user',content:'What is the Cedar launch codename?'});
  const result=fitHistory(messages,{chars:10000,count:10});
  assert.ok(result.messages[0].content.includes('MAPLE-731'));
  assert.ok(result.messages[0].content.includes('historical data'));
  assert.equal(result.messages.at(-1).content,messages.at(-1).content);
  assert.ok(result.messages.length<=10);
  assert.ok(result.messages.reduce((sum,row)=>sum+row.content.length,0)<=10000);
  assert.ok(result.dropped>0);
  assert.ok(historyDigest([{role:'user',content:'The project must use metric units.'}],'Continue').includes('metric'));
});

test('relevance wins over recency; no summary invents facts or promotes assistant claims',()=>{
  const chosen=rankExcerpts([{text:'Cedar launch MAPLE-731',updated:1},{text:'Other unrelated lunch',updated:99}],'Cedar launch');
  assert.equal(chosen.length,1);
  assert.equal(chosen[0].text,'Cedar launch MAPLE-731');
  const digest=historyDigest([{role:'assistant',content:'Cedar budget might be 42.'}],'Cedar budget');
  assert.match(digest,/not independently verified/);
  assert.match(digest,/might be 42/);
});

test('memory controls isolate accounts and pass forgotten facts to history retrieval',async()=>{
  const memory=new MemoryStore(memoryStorage(),{enabled:()=>true});
  const note=await memory.add('account-a',['Prefers tea']);
  await memory.setRecall('account-a',true);
  await memory.edit('account-a',note.items[0].id,'Prefers coffee');
  let called=0;
  const input={conversationId:'current',messages:[{role:'user',content:'Recall the tea preference'}]};
  const output=await withMemory(input,{sub:'account-a'},memory,async(sub,query,options)=>{
    called++; assert.equal(sub,'account-a'); assert.equal(options.exclude,'current');
    assert.ok(suppresses('The person prefers tea',options.forgotten)); return [];
  });
  assert.deepEqual(output.memory.notes,['Prefers coffee']);
  assert.equal((await memory.forPrompt('account-b')).notes.length,0);
  await memory.setEnabled('account-a',false);
  assert.equal((await withMemory(input,{sub:'account-a'},memory,()=>{throw Error('must not search');})).memory,undefined);
  assert.equal(called,1);
  assert.equal((await withMemory(input,{sub:'account-a',guest:true},memory)).memory,undefined);
  assert.ok(!memoryNote({notes:[],recall:[{title:'Cedar',updated:1,role:'assistant',text:'Unverified plan'}]}).includes('independently verified plan'));
});

test('recall indexing excludes running replies, generated memory markers and attachment bodies',()=>{
  const document=recallDocument({messages:[
    {role:'user',text:'Review Cedar',content:'Review Cedar\n\nAttached file: secret.txt\npassword body'},
    {role:'assistant',content:'Draft secret',running:true},
    {role:'assistant',content:'Cedar decided. [[remember: private note]]'},
  ]});
  const text=JSON.stringify(document);
  assert.doesNotMatch(text,/password body|Draft secret|private note/);
  assert.match(text,/Cedar/);
});

test('late optional context is aborted and never replaces the returned result',async()=>{
  let signal;
  await assert.rejects(within(15,received=>{signal=received;return new Promise(()=>{});}),/timed out/);
  assert.ok(signal.aborted);
});

test('a committed conversation indexes its published revision and repairs an idempotent missed write',async()=>{
  const storage=memoryStorage();storage.del=async()=>{};
  const indexed=[];
  const store=new ChatStore('account-a',storage,{index:async(...args)=>indexed.push(args)});
  const chat={id:'cedar',title:'Cedar project',messages:[{role:'user',content:'MAPLE-731'}]};
  await store.stage({id:'cedar',version:'v1',part:0,text:JSON.stringify(chat)});
  const entry=await store.commit({id:'cedar',version:'v1',parts:1});
  assert.equal(indexed[0][2].version,entry.version);
  assert.equal(indexed[0][3].messages[0].content,'MAPLE-731');
  await store.commit({id:'cedar',version:'v1',parts:1});
  assert.equal(indexed.length,2);
  await store.commit({id:'cedar',version:'v2',base:'v1',deleted:true});
  assert.equal(indexed.at(-1)[2].deleted,true);
});

test('history preparation requires the account opt-in and reads bounded batches',async()=>{
  const token='a'.repeat(64), cfg={origin:'https://example.test',secure:false};
  const req={method:'POST',headers:{origin:cfg.origin,'content-type':'application/json','x-csrf-token':token,cookie:`jarvis-csrf=${token}`},body:{action:'prepare'}};
  let reads=0;
  const store={manifest:async()=>({data:{entries:Object.fromEntries(['a','b','c','d'].map(id=>[id,{version:'v1',parts:1}]))}}),part:async(id)=>{reads++;return JSON.stringify({id,title:id,messages:[]});}};
  const res=reply();
  await assert.rejects(recallApi(req,res,cfg,{sub:'a'},{store,memory:{read:async()=>({enabled:false})}}),/Turn on/);
  await recallApi(req,res,cfg,{sub:'a'},{store,memory:{read:async()=>({enabled:true,recallEnabled:true})},index:async()=>{}});
  assert.equal(reads,3);assert.equal(res.body.done,false);assert.equal(res.body.remaining,1);
});

test('explicit Markdown table requests never silently select charts',()=>{
  const request='Show this exact data as a Markdown table: Jan 10, Feb 20, Mar 15';
  assert.equal(requestIntent(request),'table');
  assert.equal(tablePresentation(['Month','Sales'],[['Jan','10'],['Feb','20'],['Mar','15']],'',request).view,'table');
});

test('direct text routing avoids tools while retaining research, risk and context boundaries',()=>{
  assert.equal(profileRequest('Explain photosynthesis in two sentences.').fast,true);
  for(const prompt of ['Explain my previous decision','Explain the latest tax changes','Explain this document','Explain the symptoms of diabetes']) assert.equal(profileRequest(prompt).fast,false,prompt);
  assert.equal(profileRequest('Explain photosynthesis',{research:true}).fast,false);
  assert.equal(profileRequest('Explain photosynthesis',{work:true}).fast,false);
});
