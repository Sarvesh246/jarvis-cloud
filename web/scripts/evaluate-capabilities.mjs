import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {MemoryStore,withMemory} from '../server/memory.js';
import {ChatStore} from '../server/chat-store.js';
import {searchConversations,indexConversation} from '../server/recall-store.js';
import {fitHistory} from '../src/lib/attachments.js';
import {percentile} from '../evaluation/metrics.js';

const report={schema:1,at:new Date().toISOString(),model_judge_calls:0,checks:[],production_model_quality:'not measured by this script'};
async function check(name,work) {
  const start=performance.now();
  await work();
  report.checks.push({name,passed:true,ms:Math.round(performance.now()-start)});
}
try {
  await mkdir('evaluation-results',{recursive:true});
  if(!process.argv.includes('--database')) {
    const run=spawnSync(process.execPath,['--test','--test-concurrency=2','tests/capabilities.test.js','tests/baseline.test.js','tests/quality-completion.test.js'],{encoding:'utf8'});
    assert.equal(run.status,0,'Local capability regressions failed.');
    report.checks.push({name:'local capability and baseline regression suite',passed:true});
  } else {
    assert.ok(process.env.DATABASE_URL || process.env.POSTGRES_URL,'Set the test database connection in the environment.');
    const sub='vaelo-capability-evaluation-'+randomUUID(),other=sub+'-other';
    const memory=new MemoryStore(),store=new ChatStore(sub);
    const ids=[];
    try {
      await memory.add(sub,['Prefers tea']);
      await memory.setRecall(sub,true);
      const id=randomUUID();ids.push(id);
      const chat={id,title:'Synthetic Cedar decision',messages:[{role:'user',content:'For the synthetic Cedar project we decided on release codename MAPLE-731.'},{role:'user',content:'The synthetic reader prefers tea.'}]};
      await check('publish searchable account-scoped conversation',async()=>{
        await store.stage({id,version:'v1',part:0,text:JSON.stringify(chat)});
        await store.commit({id,version:'v1',parts:1});
        assert.ok((await searchConversations(sub,'Cedar codename MAPLE')).some(row=>row.text.includes('MAPLE-731')));
      });
      await check('another account cannot retrieve the decision',async()=>{
        assert.equal((await searchConversations(other,'Cedar codename MAPLE')).length,0);
      });
      await check('edited notes suppress the old preference in history',async()=>{
        const note=(await memory.read(sub)).items[0];
        await memory.edit(sub,note.id,'Prefers coffee');
        const context=await withMemory({conversationId:'another-chat',messages:[{role:'user',content:'Recall the tea preference'}]},{sub},memory);
        assert.ok(!context.memory.recall?.some(item=>/\btea\b/i.test(item.text)));
      });
      await check('replaced revisions cannot be resurrected by a delayed index write',async()=>{
        const revised={...chat,messages:[{role:'user',content:'The Cedar codename was corrected to PINE-900.'}]};
        await store.stage({id,version:'v2',part:0,text:JSON.stringify(revised)});
        await store.commit({id,version:'v2',base:'v1',parts:1});
        await indexConversation(sub,id,{version:'v1',updated:1},chat);
        const found=await searchConversations(sub,'Cedar codename');
        assert.ok(found.some(item=>item.text.includes('PINE-900')));
        assert.ok(!found.some(item=>item.text.includes('MAPLE-731')));
      });
      await check('disabled memory does not retrieve past conversations',async()=>{
        await memory.setEnabled(sub,false);
        assert.equal((await searchConversations(sub,'Cedar codename')).length,0);
        await memory.setEnabled(sub,true);
      });
      await check('deleted conversations immediately disappear from retrieval',async()=>{
        await store.commit({id,version:'deleted',base:'v2',deleted:true});
        assert.equal((await searchConversations(sub,'Cedar codename')).length,0);
      });
    } finally {
      for(const id of ids) {
        const entry=(await store.manifest()).data.entries[id];
        if(entry && !entry.deleted) await store.commit({id,version:randomUUID(),base:entry.version,deleted:true});
      }
      const notes=await memory.read(sub);
      for(const note of notes.items) await memory.remove(sub,note.id);
      await memory.setRecall(sub,false);await memory.setEnabled(sub,false);
      report.cleanup='synthetic conversations soft-deleted; synthetic memory disabled and notes removed';
    }
  }
  const messages=[{role:'user',content:'Cedar release codename MAPLE-731.'},...Array.from({length:200},(_,i)=>({role:i%2?'user':'assistant',content:'Unrelated background '+i+' '+ 'filler '.repeat(140)})),{role:'user',content:'What was the Cedar release codename?'}];
  const samples=[];
  for(let i=0;i<25;i++) {
    const start=performance.now();const fitted=fitHistory(messages,{chars:20000,count:20});
    assert.match(fitted.messages[0].content,/MAPLE-731/);
    samples.push(performance.now()-start);
  }
  report.context_retrieval={samples:25,median_ms:Number(percentile(samples,.5).toFixed(2)),p95_ms:Number(percentile(samples,.95).toFixed(2))};
  report.passed=true;
} catch(error) {report.passed=false;report.failure=error.name;process.exitCode=1;}
await writeFile('evaluation-results/capabilities-'+(process.argv.includes('--database')?'database':'local')+'.json',JSON.stringify(report,null,2)+'\n');
console.info(JSON.stringify(report));
