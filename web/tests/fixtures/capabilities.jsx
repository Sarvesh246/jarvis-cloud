// Actual application and components with disposable account/API stand-ins.
// No credentials, private data, provider calls or real verification claims.
import React from 'react';
import {createRoot} from 'react-dom/client';
import '../../src/design/tokens.css';
import '../../src/design/base.css';
import '../../src/design/personal.css';
import {App} from '../../src/App.jsx';

const user={sub:'capability-ui-fixture',name:'Test reader'};
let memory={enabled:true,recallEnabled:false,items:[{id:'one',text:'Synthetic preference: use metric units.',source:'you',updated:Date.now(),created:Date.now()}]};
const original=window.fetch.bind(window);
window.fetch=async (input,init)=>{
  const url=new URL(typeof input==='string'?input:input.url,location.href);
  const body=init?.body ? JSON.parse(init.body) : null;
  if(url.pathname==='/api/session') return Response.json({user,csrf:'fixture',configured:true});
  if(url.pathname==='/api/status') return Response.json({ready:true});
  if(url.pathname==='/api/chats' && url.searchParams.get('resource')==='memory') {
    if(body?.action==='enable') memory.enabled=body.enabled;
    if(body?.action==='recall') memory.recallEnabled=body.enabled;
    if(body?.action==='add') memory.items.push({id:String(Date.now()),text:body.text,source:'you',updated:Date.now()});
    if(body?.action==='edit') memory.items=memory.items.map(item=>item.id===body.id?{...item,text:body.text}:item);
    if(body?.action==='remove') memory.items=memory.items.filter(item=>item.id!==body.id);
    return Response.json(memory);
  }
  if(url.pathname==='/api/chats' && url.searchParams.get('resource')==='recall') return Response.json({processed:2,skipped:0,done:true,remaining:0,after:'done'});
  if(url.pathname==='/api/chats') return Response.json(body?{}:{entries:{}});
  if(url.pathname==='/api/chat' && body) {
    const reply='UI fixture — no model or code execution was used.\n\n| Month | Sales |\n| --- | ---: |\n| Jan | 10 |\n| Feb | 20 |\n| Mar | 15 |\n\nFactorisation:\n\\[x^2-5x+6=(x-2)(x-3)\\]\n\nThe roots are \\(x=2\\) and \\(x=3\\).';
    const pieces=[reply.slice(0,55),reply.slice(55,160),reply.slice(160)];
    return new Response(new ReadableStream({async start(controller){
      for(let i=0;i<pieces.length;i++) {
        controller.enqueue(new TextEncoder().encode(`id: ${i}\ndata: ${JSON.stringify({choices:[{delta:{content:pieces[i]}}]})}\n\n`));
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      controller.enqueue(new TextEncoder().encode('id: 3\nevent: jarvis.complete\ndata: {"ok":true}\n\n: end\n\n'));controller.close();
    }}),{headers:{'Content-Type':'text/event-stream'}});
  }
  if(url.pathname.startsWith('/api/')) return Response.json({error:'Unavailable in this fixture.'},{status:503});
  return original(input,init);
};
createRoot(document.getElementById('root')).render(<App/>);
