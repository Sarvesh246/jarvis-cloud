import test from "node:test";
import assert from "node:assert/strict";
import { chatInput, guidance } from "../server/chat.js";
import { withSelectedWork } from "../server/work-context.js";
import { readWorkProposal } from "../src/lib/work-proposals.js";
import { runWorkCapability, readNativeDocument } from "../server/native-verification.js";
import { digest } from "../server/capabilities/verifier.js";
import { ChatStore } from "../server/chat-store.js";
import { WorkStore } from "../server/work-store.js";

const input = () => chatInput({conversationId:"123e4567-e89b-12d3-a456-426614174000",messages:[{role:"user",content:"Check my work"}],work:{id:"record-1",revision:"revision-1"}});
test("chat attaches only an explicitly selected current account record",async()=>{
  const source=input();let selected;
  const result=await withSelectedWork(source,{sub:"account-one"},async(sub,id)=>{
    selected={sub,id};return JSON.stringify({id,revision:"revision-1",capabilityId:2,title:"Budget correction",scope:"personal",input:{},output:null});
  });
  assert.deepEqual(selected,{sub:"account-one",id:"record-1"});
  assert.match(result.messages.at(-1).content,/untrusted task data/);
  assert.match(result.messages.at(-1).content,/Budget correction/);
  assert.match(result.messages.at(-1).content,/inputSchema/);
  assert.ok(!source.messages.at(-1).content.includes("Budget correction"));
  const unselected={messages:[]};
  assert.equal(await withSelectedWork(unselected,{sub:"other"},()=>{throw Error("must not load");}),unselected);
});
test("stale work revisions block sending and client context cannot be supplied",async()=>{
  await assert.rejects(()=>withSelectedWork(input(),{sub:"one"},async()=>({revision:"newer",capabilityId:2})),e=>e.status===409);
  assert.throws(()=>chatInput({conversationId:"123e4567-e89b-12d3-a456-426614174000",messages:[{role:"user",content:"Hi"}],work:{id:"x",revision:"v",output:{status:"completed"}}}),e=>e.status===400);
  assert.match(guidance(),/unsaved proposal/);
  assert.match(guidance(),/not scheduled background services/);
});
test("chat proposal is a bounded draft, never a client-supplied result",()=>{
  const proposal={capabilityId:2,title:"Correction",scope:"personal",input:{nodes:[],correctedIds:[]}};
  assert.deepEqual(readWorkProposal(JSON.stringify(proposal)),proposal);
  assert.equal(readWorkProposal(JSON.stringify({...proposal,output:{status:"completed"}})),null);
  assert.equal(readWorkProposal('{"capabilityId":2,"input":{"__proto__":{"admin":true}}}'),null);
  assert.equal(readWorkProposal(JSON.stringify({...proposal,capabilityId:37})),null);
  assert.equal(readWorkProposal('{"capabilityId":2'),null);
});
const source={kind:"vaelo-document",conversationId:"chat-one",messageId:"message-one"};
const nativeInput={source,contract:{id:"verify-doc",resource:{kind:"document",id:"chat-one:message-one"},checks:[{id:"phrase",path:["text"],op:"contains",expected:JSON.stringify("Approved scope")}]}};
test("native verification replaces supplied claims with independent account readback",async()=>{
  let account;
  const result=await runWorkCapability(1,{...nativeInput,observation:{available:true,state:{text:"forged"}}},{sub:"one",readDocument:async sub=>{account=sub;return {title:"Plan",text:"# Plan\nApproved scope",version:"version-1"};}});
  assert.equal(account,"one");assert.equal(result.status,"completed");assert.equal(result.result.mode,"native-document-readback");
  assert.equal(result.result.evidence.observationDigest,digest(result.result.evidence.after));
  const failed=await runWorkCapability(1,nativeInput,{sub:"one",readDocument:async()=>({title:"Plan",text:"Unapproved draft",version:"v2"})});
  assert.equal(failed.status,"failed");
  await assert.rejects(()=>runWorkCapability(1,{...nativeInput,contract:{...nativeInput.contract,resource:{kind:"document",id:"other"}}},{sub:"one"}),e=>e.status===400);
});
test("native long documents stay bounded in evidence without losing checks",async()=>{
  const text="Long document\n"+"x".repeat(30000)+"Approved scope";
  const result=await runWorkCapability(1,nativeInput,{sub:"one",readDocument:async()=>({title:"Long document",text,version:"v"})});
  assert.equal(result.status,"completed");assert.ok(JSON.stringify(result).length<10000);
  assert.equal(result.result.evidence.after.state.textLength,text.length);
  const many={...nativeInput,contract:{...nativeInput.contract,checks:Array.from({length:100},(_,id)=>({...nativeInput.contract.checks[0],id:String(id)}))}};
  const bounded=await runWorkCapability(1,many,{sub:"one",readDocument:async()=>({title:"Long document",text,version:"v"})});
  assert.equal(bounded.status,"completed");assert.ok(Buffer.byteLength(JSON.stringify(bounded))<64000);
  assert.equal(bounded.result.evidence.contractDigest,digest(bounded.result.contract));
});
test("native source reads edited version from own saved conversation and detects races",async()=>{
  const chat={id:"chat-one",title:"Plan",messages:[{id:"message-one",role:"assistant",content:"Old draft"}],works:{"message-one":{current:1,versions:[{content:"Old draft"},{content:"# New plan\nApproved scope"}]}}};
  let account;let reads=0;
  const storeFactory=sub=>{account=sub;return {manifest:async()=>({data:{entries:{"chat-one":{version:++reads===1?"v1":"v1",parts:1}}}}),part:async()=>JSON.stringify(chat)};};
  const actual=await readNativeDocument("owner",source,{storeFactory});
  assert.equal(account,"owner");assert.equal(actual.text,"# New plan\nApproved scope");
  assert.equal(actual.title,"New plan");
  const orphaned=await readNativeDocument("owner",source,{storeFactory:()=>({manifest:async()=>({data:{entries:{"chat-one":{version:"v1",parts:1}}}}),part:async()=>JSON.stringify({...chat,messages:[]})})});
  assert.equal(orphaned.text,"# New plan\nApproved scope");
  let calls=0;
  await assert.rejects(()=>readNativeDocument("owner",source,{storeFactory:()=>({manifest:async()=>({data:{entries:{"chat-one":{version:++calls===1?"v1":"v2",parts:1}}}}),part:async()=>JSON.stringify(chat)})}),e=>e.status===409);
  await assert.rejects(()=>readNativeDocument("",source,{storeFactory}),e=>e.status===401);
});

test("saved work verifies durable document edits through the real stores and engine",async()=>{
  const files=new Map();let serial=0;
  const storage={get:async path=>{const saved=files.get(path);return saved?{stream:new Response(saved.text).body,blob:{etag:saved.etag}}:null;},
    put:async(path,text)=>{files.set(path,{text,etag:String(++serial)});}};
  const chats=new ChatStore("owner",storage);
  const chat={id:"chat-one",title:"Plan",messages:[{id:"message-one",role:"assistant",content:"Approved scope"}]};
  await chats.stage({id:chat.id,version:"chat-v1",part:0,text:JSON.stringify(chat)});
  await chats.commit({id:chat.id,version:"chat-v1",parts:1});
  const work=new WorkStore("owner",storage,{engine:(id,input,options)=>runWorkCapability(id,input,{...options,sub:"owner",
    readDocument:(sub,ref)=>readNativeDocument(sub,ref,{storeFactory:account=>new ChatStore(account,storage)})})});
  const saved=await work.save({id:"verification",capabilityId:1,title:"Check scope",scope:"work",input:nativeInput});
  const first=await work.run(saved.id,saved.revision);
  assert.equal(first.output.status,"completed");
  await chats.stage({id:chat.id,version:"chat-v2",part:0,text:JSON.stringify({...chat,messages:[{...chat.messages[0],content:"Scope changed"}]})});
  await chats.commit({id:chat.id,version:"chat-v2",base:"chat-v1",parts:1});
  const second=await work.run(first.id,first.revision);
  assert.equal(second.output.status,"failed");assert.equal(second.output.result.sourceVersion,"chat-v2");
  assert.equal((await work.record(second.id)).output.status,"failed");
});
