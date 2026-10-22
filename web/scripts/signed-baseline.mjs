/* Creates and revokes a disposable test-account session using the configured
   application signing path. No owner chats or memory are read or changed. */
import {randomUUID} from 'node:crypto';
import {decodeJwt} from 'jose';
import {settings,signSession,cookieNames} from '../server/security.js';
import {devices} from '../server/devices.js';
import {revocations} from '../server/revocation.js';
import {main} from './baseline.mjs';
import {memories} from '../server/memory.js';
import {ChatStore} from '../server/chat-store.js';

const cfg=settings();
const sub='vaelo-benchmark-'+randomUUID();
let token;
let fixture;
try {
  if(!cfg.email || cfg.secret.length<32 || !(process.env.DATABASE_URL || process.env.POSTGRES_URL)) throw Error('Test configuration unavailable.');
  token=await signSession({sub,email:cfg.email,name:'Capability benchmark'},cfg,'jarvis-web',{label:'Disposable capability benchmark'});
  if(process.argv.includes('--with-memory-fixture')) {
    await memories.setRecall(sub,true);
    const store=new ChatStore(sub),id=randomUUID();
    fixture={store,id};
    const chat={id,title:'Synthetic Cedar decision',messages:[{role:'user',content:'For the synthetic Cedar project, we decided on codename MAPLE-731.'}]};
    await store.stage({id,version:'v1',part:0,text:JSON.stringify(chat)});
    await store.commit({id,version:'v1',parts:1});
  }
  process.env.VAELO_BENCH_COOKIE=`${cookieNames(cfg).session}=${token}`;
  process.env.VAELO_BENCH_SUB=sub;
  process.argv=[...process.argv.slice(0,2),'--mode','signed-in','--origin',cfg.origin,...process.argv.slice(2)];
  await main();
} catch {console.error('Signed-in baseline failed; no credentials or account data were printed.');process.exitCode=1;}
finally {
  delete process.env.VAELO_BENCH_COOKIE;
  delete process.env.VAELO_BENCH_SUB;
  const cleanups=[];
  if(fixture) cleanups.push((async()=>{
      const entry=(await fixture.store.manifest()).data.entries[fixture.id];
      if(entry && !entry.deleted) await fixture.store.commit({id:fixture.id,version:randomUUID(),base:entry.version,deleted:true});
      await memories.setRecall(sub,false);await memories.setEnabled(sub,false);
  })());
  if(token) cleanups.push(revocations.revoke(sub,'jarvis-web'),devices.revoke(sub,decodeJwt(token).did));
  if((await Promise.allSettled(cleanups)).some(result=>result.status==='rejected')) {console.error('Synthetic test cleanup needs attention.');process.exitCode=1;}
}
