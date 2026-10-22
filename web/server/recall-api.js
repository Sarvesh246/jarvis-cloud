import { memories } from './memory.js';
import { ChatStore } from './chat-store.js';
import { indexConversation } from './recall-store.js';
import { sameOrigin, readJson, json, HttpError } from './security.js';

export async function recallApi(req,res,cfg,user,{store=new ChatStore(user.sub),memory=memories,index=indexConversation}={}) {
  if(req.method!=='POST') throw new HttpError(405,'Method not allowed.');
  sameOrigin(req,cfg);
  const body=await readJson(req,2000);
  if(body?.action!=='prepare' || typeof (body.after ?? '')!=='string' || (body.after || '').length>100) throw new HttpError(400,'Invalid history preparation request.');
  const preferences=await memory.read(user.sub);
  if(!preferences.enabled || !preferences.recallEnabled) throw new HttpError(409,'Turn on memory and past conversations first.');
  const {data}=await store.manifest();
  const ids=Object.keys(data.entries).filter(id=>!data.entries[id].deleted && id>(body.after || '')).sort();
  let processed=0, skipped=0;
  for(const id of ids.slice(0,3)) {
    const entry=data.entries[id];
    if(entry.parts>8) {skipped++;continue;}
    const chunks=await Promise.all(Array.from({length:entry.parts},(_,part)=>store.part(id,entry.version,part)));
    const text=chunks.join('');
    if(text.length>4000000) {skipped++;continue;}
    const chat=JSON.parse(text);
    if(chat?.id!==id || !Array.isArray(chat.messages)) throw new HttpError(409,'A conversation changed; try preparing history again.');
    await index(user.sub,id,entry,chat);
    processed++;
  }
  json(res,200,{processed,skipped,after:ids[Math.min(3,ids.length)-1] || body.after || '',done:ids.length<=3,remaining:Math.max(0,ids.length-3)});
}
