// This explicit development-only fixture never changes production auth or APIs.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/newsreader/opsz.css';
import '../../src/design/tokens.css';
import '../../src/design/base.css';
import { Workroom } from '../../src/components/Workroom.jsx';
import { WorkroomIcon } from '../../src/components/WorkroomIcon.jsx';
import { chatToWorkspace } from '../../src/lib/workroom.js';
import '../../src/design/refinements.css';

const records=new Map(), texts=new Map(); let conflictOnce=false;
// Not a real content hash: the fixture only needs a stable key per text.
const fakeSha=text=>[...text].reduce((h,c)=>(h*31+c.charCodeAt(0))>>>0,7).toString(16).padStart(8,'0').repeat(8);
const nativeFetch=window.fetch.bind(window);
window.fetch=async(url,options={})=>{
  if(!String(url).startsWith('/api/work')) return nativeFetch(url,options);
  const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
  if(!options.method){
    const query=new URL(url,location.origin).searchParams;
    if(!query.has('id')) return response({records:[...records.values()]});
    const record=records.get(query.get('id'));
    return response({record,documents:Object.fromEntries(record.documents.map(d=>[d.sha,texts.get(d.sha)??null]))});
  }
  const body=JSON.parse(options.body);
  if(conflictOnce) {conflictOnce=false;return response({error:'Fixture conflict: another device changed this version.'},409);}
  const old=records.get(body.id||body.record?.id);
  if((old?.revision??null)!==body.base)return response({error:'Fixture revision conflict.'},409);
  if(body.action==='delete'){records.delete(body.id);return response({record:{id:body.id,deleted:true,revision:crypto.randomUUID()}});}
  let record;
  if(body.action==='save'){
    const documents=body.record.documents.map(d=>{
      if(typeof d.text!=='string'){const known=[...records.values()].flatMap(r=>r.documents).find(x=>x.sha===d.sha);return {...d,chars:known?.chars??0};}
      const sha=fakeSha(d.text);texts.set(sha,d.text);return {id:d.id,slot:d.slot,name:d.name,sha,chars:d.text.length};
    });
    record={...body.record,documents,output:null};
  } else record={...old,output:{status:'computed',summary:'Fixture output only.',
    result:{status:'partial',symbol:'$',owed:49.99,received:20,stillOwed:29.99,chaseNow:true,chaseBy:'2026-10-10',waiting:[]},
    limitations:['This browser fixture does not run the production check engine.']}};
  record.revision=crypto.randomUUID();record.updated=new Date().toISOString();records.set(record.id,record);return response({record});
};
const sampleChat={title:'Weekly client report',messages:[
  {role:'user',text:'Summarise this week for the client in five bullets, plain English, no jargon.',attachments:[{name:'week-notes.md',kind:'text',state:'ready',body:'- Shipped login\n- Fixed export bug'}]},
  {role:'assistant',content:'Here you go.'},{role:'user',content:'Always end with next week’s plan.'}]};
function Fixture(){
  const [open,setOpen]=useState(true),[started,setStarted]=useState(''),[initial,setInitial]=useState(null);
  return <><main style={{padding:'2rem'}}><h1>Workroom component test fixture</h1><p>Mock account and in-memory API. No production sign-in, check engine, model call or persistence.</p>
    <button onClick={()=>{setInitial(null);setOpen(true);}}><WorkroomIcon open={open} />Open workroom</button>
    <button onClick={()=>{conflictOnce=true;setOpen(true);}}>Make next write conflict</button>
    <button onClick={()=>{const {draft}=chatToWorkspace(sampleChat);setInitial({draft,message:'Your requests became the instructions. Edit anything, then save.'});setOpen(true);}}>Save a sample chat as a workspace</button>
    <p role="status">{started}</p></main>
    <Workroom open={open} onClose={()=>setOpen(false)} initialDraft={initial} session={{user:{sub:'workroom-component-fixture'},csrf:'fixture-only'}}
      onStart={(record,prompt)=>{setStarted(`Started a conversation with ${record.title} · ${record.documents.length} documents${prompt?` · sent “${prompt}”`:''}`);setOpen(false);}} /></>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
