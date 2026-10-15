// This explicit development-only fixture never changes production auth or APIs.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/newsreader/opsz.css';
import '../../src/design/tokens.css';
import '../../src/design/base.css';
import { Workroom } from '../../src/components/Workroom.jsx';

const records=new Map(); let conflictOnce=false;
const nativeFetch=window.fetch.bind(window);
window.fetch=async(url,options={})=>{
  if(url!=='/api/work') return nativeFetch(url,options);
  const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
  if(!options.method) return response({records:[...records.values()]});
  const body=JSON.parse(options.body);
  if(conflictOnce) {conflictOnce=false;return response({error:'Fixture conflict: another device changed this version.'},409);}
  const old=records.get(body.id||body.record?.id);
  if((old?.revision??null)!==body.base)return response({error:'Fixture revision conflict.'},409);
  if(body.action==='delete'){records.delete(body.id);return response({record:{id:body.id,deleted:true,revision:crypto.randomUUID()}});}
  const record=body.action==='save'?{...body.record,output:null}:{...old,output:{status:'needs-review',summary:'Fixture output: review your supplied information.',result:{notice:'Mock API response for component testing only.',suppliedInputs:old.input},limitations:['This browser fixture does not run the production capability engine.']}};
  record.revision=crypto.randomUUID();record.updated=new Date().toISOString();records.set(record.id,record);return response({record});
};
function Fixture(){
  const [open,setOpen]=useState(true),[discussed,setDiscussed]=useState('');
  return <><main style={{padding:'2rem'}}><h1>Workroom component test fixture</h1><p>Mock account and in-memory API. No production sign-in, engine run, or persistence.</p><button onClick={()=>setOpen(true)}>Open workroom</button><button onClick={()=>{conflictOnce=true;setOpen(true);}}>Make next write conflict</button><p role="status">{discussed}</p></main><Workroom open={open} onClose={()=>setOpen(false)} session={{user:{sub:'workroom-component-fixture'},csrf:'fixture-only'}} onDiscuss={record=>{setDiscussed(`Selected saved version: ${record.title} · ${record.revision}`);setOpen(false);}} /></>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
