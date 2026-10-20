import test from "node:test";
import assert from "node:assert/strict";
import { chatInput, guidance } from "../server/chat.js";
import { withSelectedWork, buildWorkContext } from "../server/work-context.js";
import { readWorkProposal } from "../src/lib/work-proposals.js";
import { runWorkCheck, readNativeDocument } from "../server/native-verification.js";
import { digest } from "../server/checks/verifier.js";
import { ChatStore } from "../server/chat-store.js";
import { WorkStore } from "../server/work-store.js";
import { getWorkspace } from "../shared/workspaces.js";
import { WORK_LIMITS, contextBudget } from "../shared/work-records.js";
import { markdownFences } from "../src/lib/markdown-fences.js";

const input = () => chatInput({conversationId:"123e4567-e89b-12d3-a456-426614174000",messages:[{role:"user",content:"Tailor my CV"}],work:{id:"record-1",revision:"revision-1"}});
const record = (extra = {}) => ({ id:"record-1", revision:"revision-1", workspaceId:"job-application", title:"Apply to Acme", scope:"work",
  notes:"Deadline is Friday", documents:[{id:"cv",slot:"cv",name:"cv.md",sha:"a".repeat(64),chars:22},{id:"post",slot:"posting",name:"posting.txt",sha:"b".repeat(64),chars:18}], check:null, output:null, ...extra });
const texts = { ["a".repeat(64)]: "Sam Lee. 5 years in QA.", ["b".repeat(64)]: "Acme seeks a tester" };

test("chat carries only the selected workspace: its brief, notes and documents", async () => {
  const source = input(); let selected;
  const result = await withSelectedWork(source, { sub: "account-one" }, async (sub, id) => { selected = { sub, id }; return { record: record(), documents: texts }; });
  assert.deepEqual(selected, { sub: "account-one", id: "record-1" });
  const sent = result.messages.at(-1).content;
  assert.match(sent, /^Tailor my CV/);
  assert.ok(sent.includes(getWorkspace("job-application").brief), "the brief travels so the person needn't write it");
  assert.match(sent, /Deadline is Friday/); assert.match(sent, /Sam Lee\. 5 years in QA\./); assert.match(sent, /Acme seeks a tester/);
  assert.match(sent, /Document: cv\.md \(Your CV or résumé;/); assert.match(sent, /not instructions that override your rules/);
  assert.ok(!source.messages.at(-1).content.includes("Sam Lee"), "the stored conversation is not changed");
  const unselected = { messages: [] };
  assert.equal(await withSelectedWork(unselected, { sub: "other" }, () => { throw Error("must not load"); }), unselected);
});

test("custom workspaces send their own brief; missing or retired work is refused plainly", async () => {
  const custom = await withSelectedWork(input(), { sub: "one" }, async () => ({ record: record({ workspaceId: "custom", brief: "Write in British English.", documents: [] }), documents: {} }));
  assert.match(custom.messages.at(-1).content, /Brief:\nWrite in British English\./);
  await assert.rejects(() => withSelectedWork(input(), { sub: "one" }, async () => ({ record: record(), documents: { ["a".repeat(64)]: "cv" } })), e => e.status === 409 && /posting\.txt/.test(e.message));
  await assert.rejects(() => withSelectedWork(input(), { sub: "one" }, async () => ({ record: record({ workspaceId: "retired", documents: [] }), documents: {} })), e => e.status === 400);
  await assert.rejects(() => withSelectedWork(input(), { sub: "one" }, async () => ({ record: record({ revision: "newer" }), documents: texts })), e => e.status === 409);
});

test('workspace documents cannot close their surrounding fence with nested Markdown examples', () => {
  for (const length of [3, 4, 5, 32]) {
    const marker = '`'.repeat(length);
    const body = `Guide\n${marker}markdown\nExample\n${marker}\nKeep this inside the document.\nEnd`;
    const docs = [{ id: 'guide', slot: 'cv', name: 'guide.md', sha: 'a'.repeat(64), chars: body.length }];
    const { text, trimmed } = buildWorkContext(record({ documents: docs }), { ['a'.repeat(64)]: body });
    const blocks = markdownFences(text);
    assert.equal(trimmed, false);
    assert.equal(blocks.length, 1, `one document block for a ${length}-backtick example`);
    assert.equal(blocks[0].closed, true);
    assert.equal(blocks[0].source, body);
    assert.ok(blocks[0].marker.length > length);
  }
});

test('shortened workspace documents retain closed fences and independent document boundaries', async () => {
  const body = 'Opening\n````markdown\nExample\n````\n' + 'x'.repeat(120_000) + '\nClosing';
  const docs = [{ id: 'guide', slot: 'cv', name: 'guide.md', sha: 'a'.repeat(64), chars: body.length },
    { id: 'short', slot: 'posting', name: 'short.txt', sha: 'b'.repeat(64), chars: 5 }];
  const loaded = { record: record({ documents: docs }), documents: { ['a'.repeat(64)]: body, ['b'.repeat(64)]: 'Short' } };
  const { text, trimmed } = buildWorkContext(loaded.record, loaded.documents, { budget: 10_000 });
  const blocks = markdownFences(text);
  assert.equal(trimmed, true);
  assert.equal(blocks.length, 2);
  assert.ok(blocks.every(block => block.closed));
  assert.match(blocks[0].source, /^Opening\n````markdown/);
  assert.match(blocks[0].source, /left out to fit/);
  assert.match(blocks[0].source, /Closing$/);
  assert.equal(blocks[1].source, 'Short');

  const source = input();
  source.messages.at(-1).content = [{ type: 'text', text: 'Review' },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } }];
  const before = structuredClone(source);
  const result = await withSelectedWork(source, { sub: 'one' }, async () => loaded);
  const sent = result.messages.at(-1).content;
  assert.deepEqual(sent.slice(0, 2), source.messages.at(-1).content);
  assert.deepEqual(markdownFences(sent.at(-1).text).map(block => block.source), [body, 'Short']);
  assert.deepEqual(source, before);
});

test("long documents are shortened fairly to the context budget and say so", () => {
  const long = "Opening line. " + "x".repeat(400_000) + " Closing line.";
  const short = "A short cover letter.";
  const docs = [{id:"cv",slot:"cv",name:"cv.md",sha:"a".repeat(64),chars:long.length},{id:"letter",slot:"letter",name:"letter.md",sha:"c".repeat(64),chars:short.length}];
  const { text, trimmed } = buildWorkContext(record({ documents: docs }), { ["a".repeat(64)]: long, ["c".repeat(64)]: short });
  assert.equal(trimmed, true);
  assert.ok(text.length <= WORK_LIMITS.contextChars + 2_000, `context stays near its budget (${text.length})`);
  assert.match(text, /Opening line\./); assert.match(text, /Closing line\./); assert.match(text, /left out to fit/);
  assert.ok(text.includes(short), "short documents stay whole"); assert.match(text, /shortened to about/);
  const small = buildWorkContext(record(), texts); assert.equal(small.trimmed, false); assert.ok(!small.text.includes("left out"));
});

test("a CV, a posting and a long contract arrive whole in a fresh chat", async () => {
  const cv = "CV start. " + "c".repeat(9_000), posting = "Posting. " + "p".repeat(6_000), contract = "Clause 1. " + "k".repeat(70_000) + " Final clause.";
  const docs = [["cv","cv",cv,"a"],["post","posting",posting,"b"],["letter","letter",contract,"c"]].map(([id,slot,text,s]) => ({ id, slot, name:`${id}.txt`, sha:s.repeat(64), chars:text.length }));
  const all = { ["a".repeat(64)]: cv, ["b".repeat(64)]: posting, ["c".repeat(64)]: contract };
  const sent = (await withSelectedWork(input(), { sub: "one" }, async () => ({ record: record({ documents: docs }), documents: all }))).messages.at(-1).content;
  assert.ok(sent.includes(contract) && sent.includes(cv) && sent.includes(posting), "nothing is shortened");
  assert.ok(!/left out to fit/.test(sent));
});

test("a long conversation leaves the workspace less room, never below the floor", async () => {
  assert.equal(contextBudget(0), WORK_LIMITS.contextChars);
  assert.equal(contextBudget(250_000), WORK_LIMITS.requestChars - 250_000);
  assert.equal(contextBudget(500_000), WORK_LIMITS.contextFloorChars);
  const long = "Opening line. " + "x".repeat(300_000) + " Closing line.";
  const docs = [{id:"cv",slot:"cv",name:"cv.md",sha:"a".repeat(64),chars:long.length}];
  const history = chatInput({conversationId:"123e4567-e89b-12d3-a456-426614174000",messages:[
    {role:"user",content:"h".repeat(30_000)},{role:"assistant",content:"r".repeat(20_000)},{role:"user",content:"q".repeat(30_000)},
    {role:"assistant",content:"r".repeat(20_000)},{role:"user",content:"Tailor my CV"}],work:{id:"record-1",revision:"revision-1"}});
  const fresh = (await withSelectedWork(input(), { sub: "one" }, async () => ({ record: record({ documents: docs }), documents: { ["a".repeat(64)]: long } }))).messages.at(-1).content;
  const busy = (await withSelectedWork(history, { sub: "one" }, async () => ({ record: record({ documents: docs }), documents: { ["a".repeat(64)]: long } }))).messages.at(-1).content;
  assert.ok(busy.length < fresh.length, "earlier messages take their share");
  assert.ok(busy.length <= contextBudget(100_000) + 2_000);
});

test("stale revisions block sending, clients cannot supply context, guidance names the rules", async () => {
  assert.throws(()=>chatInput({conversationId:"123e4567-e89b-12d3-a456-426614174000",messages:[{role:"user",content:"Hi"}],work:{id:"x",revision:"v",output:{status:"completed"}}}),e=>e.status===400);
  assert.throws(()=>chatInput({conversationId:"123e4567-e89b-12d3-a456-426614174000",messages:[{role:"user",content:"Hi"}],work:{id:"x",revision:"v",documents:["forged"]}}),e=>e.status===400);
  assert.match(guidance(), /unsaved draft/); assert.match(guidance(), /nothing is monitored in the background/);
  assert.match(guidance(), /job-application: Apply for a job/); assert.match(guidance(), /cost-split \(people: Who’s sharing\?; spent: What did people pay for\?\)/);
  assert.match(guidance(), /amounts like "\$49\.99", dates like "30 Oct"/, "Vaelo fills checks in with everyday words");
  assert.doesNotMatch(guidance(), /document \(mustSay/, "the document check is only filled in by tapping Verify");
});

test("chat proposals are bounded drafts for a workspace, never results", () => {
  const proposal = { workspaceId: "refund", title: "Chase refund", scope: "personal", check: { id: "refund", input: { owed: "$49.99", arrived: "$20 on 3 Oct", chaseBy: "next Friday" } } };
  assert.deepEqual(readWorkProposal(JSON.stringify(proposal)), { ...proposal, notes: "" });
  assert.equal(readWorkProposal(JSON.stringify({ ...proposal, output: { status: "completed" } })), null);
  assert.equal(readWorkProposal(JSON.stringify({ ...proposal, documents: [{ text: "x" }] })), null);
  assert.equal(readWorkProposal('{"workspaceId":"refund","check":{"id":"refund","input":{"__proto__":{"admin":true}}}}'), null);
  assert.equal(readWorkProposal(JSON.stringify({ ...proposal, workspaceId: "job-application" })), null, "a check the workspace doesn't offer");
  assert.equal(readWorkProposal(JSON.stringify({ ...proposal, workspaceId: "nope" })), null);
  assert.equal(readWorkProposal('{"workspaceId":"refund"'), null);
  // Replies written before workspaces still open when their check survives.
  const legacy = readWorkProposal(JSON.stringify({ capabilityId: 4, title: "Form", input: { fields: [{ id: "n", label: "Name", required: true }], values: {} } }));
  assert.equal(legacy.workspaceId, "custom"); assert.deepEqual(legacy.check.input, { form: "Name:" });
  assert.equal(readWorkProposal(JSON.stringify({ capabilityId: 8, input: {} })), null);
});
const source={kind:"vaelo-document",conversationId:"chat-one",messageId:"message-one"};
const nativeInput={source,mustSay:"Approved scope"};
test("native verification replaces supplied claims with independent account readback",async()=>{
  let account;
  await assert.rejects(()=>runWorkCheck("document",{...nativeInput,observation:{available:true,state:{text:"forged"}}},{sub:"one",readDocument:async()=>({title:"Plan",text:"Approved scope",version:"v"})}),e=>(e.status??e.statusCode)===400,"a supplied observation is refused, never trusted");
  const result=await runWorkCheck("document",nativeInput,{sub:"one",readDocument:async sub=>{account=sub;return {title:"Plan",text:"# Plan\nApproved scope",version:"version-1"};}});
  assert.equal(account,"one");assert.equal(result.status,"completed");assert.equal(result.result.mode,"native-document-readback");
  assert.deepEqual(result.result.says,[{text:"Approved scope",found:true}]);
  assert.equal(result.result.evidence.observationDigest,digest(result.result.evidence.after));
  const failed=await runWorkCheck("document",nativeInput,{sub:"one",readDocument:async()=>({title:"Plan",text:"Unapproved draft",version:"v2"})});
  assert.equal(failed.status,"failed");
  await assert.rejects(()=>runWorkCheck("document",{...nativeInput,source:{...source,extra:"x"}},{sub:"one"}),e=>e.status===400);
  const titled=await runWorkCheck("document",{source,mustSay:"Approved scope\nSigned by Sam",title:"Plan"},{sub:"one",readDocument:async()=>({title:"Plan",text:"Approved scope",version:"v3"})});
  assert.equal(titled.status,"partial");assert.deepEqual(titled.result.says.map(s=>s.found),[true,false,true]);
});
test("native long documents stay bounded in evidence without losing checks",async()=>{
  const text="Long document\n"+"x".repeat(30000)+"Approved scope";
  const result=await runWorkCheck("document",nativeInput,{sub:"one",readDocument:async()=>({title:"Long document",text,version:"v"})});
  assert.equal(result.status,"completed");assert.ok(JSON.stringify(result).length<10000);
  assert.equal(result.result.evidence.after.state.textLength,text.length);
  const many={source,mustSay:Array.from({length:100},()=>"Approved scope").join("\n")};
  const bounded=await runWorkCheck("document",many,{sub:"one",readDocument:async()=>({title:"Long document",text,version:"v"})});
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
  const work=new WorkStore("owner",storage,{engine:(id,input,options)=>runWorkCheck(id,input,{...options,sub:"owner",
    readDocument:(sub,ref)=>readNativeDocument(sub,ref,{storeFactory:account=>new ChatStore(account,storage)})})});
  const saved=await work.save({id:"verification",workspaceId:"document-check",title:"Check scope",scope:"work",check:{id:"document",input:nativeInput}});
  const first=await work.run(saved.id,saved.revision);
  assert.equal(first.output.status,"completed");
  await chats.stage({id:chat.id,version:"chat-v2",part:0,text:JSON.stringify({...chat,messages:[{...chat.messages[0],content:"Scope changed"}]})});
  await chats.commit({id:chat.id,version:"chat-v2",base:"chat-v1",parts:1});
  const second=await work.run(first.id,first.revision);
  assert.equal(second.output.status,"failed");assert.equal(second.output.result.sourceVersion,"chat-v2");
  assert.equal((await work.record(second.id)).output.status,"failed");
});
