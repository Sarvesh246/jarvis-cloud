import test from "node:test";
import assert from "node:assert/strict";
import { indexedDB } from "fake-indexeddb";
import { loadChatCache, saveChatCache } from "../src/lib/chat-cache.js";
import { markdownParts } from "../src/lib/markdown-parts.js";
import { MemoryStore } from "../server/memory.js";
import { memoryPermission, verifyMemoryPermission } from "../server/memory-permission.js";
import { issueGuest, guestNetwork } from "../server/guest-limit.js";
import { journalAuthorized } from "../server/run-journal.js";
import { memoryStorage } from "./helpers-storage.js";

test("local chat cache survives reload, isolates accounts, preserves deletions and migrates only after commit", async () => {
  globalThis.indexedDB = indexedDB;
  const rows = new Map([["vaelo-sync:cache-owner", "legacy"]]);
  globalThis.localStorage = { getItem: key => rows.get(key), removeItem: key => rows.delete(key) };
  const chat = { id: "a", title: "A", messages: [], updated: 1 };
  await saveChatCache("cache-owner", { chats: [chat], base: { a: {version:"v1"} }, deleted: [] });
  assert.equal(rows.has("vaelo-sync:cache-owner"), false);
  assert.deepEqual((await loadChatCache("cache-owner")).chats, [chat]);
  assert.equal(await loadChatCache("other-account"), null);
  await saveChatCache("cache-owner", { chats: [], base: { a: {version:"v1"} }, deleted: ["a"] });
  const saved = await loadChatCache("cache-owner");
  assert.deepEqual(saved.chats, []); assert.deepEqual(saved.deleted, ["a"]);
});

test("streaming Markdown splits independent prose and closed fences but retains document-wide constructs", () => {
  const text = "First paragraph.\n\n```js\nconst a = 1;\n\nconst b = 2;\n```\n\nOpen tail";
  const parts = markdownParts(text);
  assert.equal(parts.length, 3); assert.equal(parts.join(""), text);
  assert.ok(parts[1].includes("const b = 2"));
  const program = "Intro.\n\n```js\nconst values = [1, 2];\n\n    const indented = true;\n```\n\nTail";
  assert.equal(markdownParts(program).length, 3, "code brackets and indentation are not Markdown references or lists");
  for (const content of ["- first\n\n- second", "Reference [a]\n\n[a]: https://example.com", "$$\nx + y\n\n$$", "> first\n\n> second"])
    assert.deepEqual(markdownParts(content), [content]);
});

test("automatic memory grants bind to one run and are consumed atomically", async () => {
  const cfg = {secret:"synthetic-memory-secret-12345678901234567890"};
  const token = await memoryPermission(cfg,"owner","run-one");
  assert.equal(await verifyMemoryPermission(cfg,"owner",token,"run-one"), true);
  assert.equal(await verifyMemoryPermission(cfg,"owner",token,"run-two"), false);
  const memory = new MemoryStore(memoryStorage(), {enabled:()=>true});
  const results = await Promise.allSettled([
    memory.add("owner",["Prefers tea"],"vaelo","run-one"),
    memory.add("owner",["Prefers coffee"],"vaelo","run-one"),
  ]);
  assert.equal(results.filter(result=>result.status==="fulfilled").length,1);
  assert.equal((await memory.read("owner")).items.length,1);
});

test("fresh guest tokens cannot reset the network subject or mint limit", async () => {
  const previous = process.env.VERCEL; delete process.env.VERCEL;
  try {
    const cfg={secret:"synthetic-guest-secret-12345678901234567890",origin:"https://example.com"};
    const req={socket:{remoteAddress:"192.0.2.8"},headers:{"x-forwarded-for":"192.0.2.99"}};
    const values = new Map();
    const store={async update(key,change){values.set(key,change(values.get(key)||{hour:0,count:0}));}};
    assert.equal(guestNetwork(req,cfg,1000),guestNetwork({...req,headers:{}},cfg,1000));
    const tokens=[]; for(let i=0;i<10;i++) tokens.push(await issueGuest(req,cfg,store,1000));
    const claims=tokens.map(token=>JSON.parse(Buffer.from(token.split('.')[1],'base64url')));
    assert.equal(new Set(claims.map(value=>value.sub)).size,1);
    await assert.rejects(issueGuest(req,cfg,store,1000),{status:429});
    assert.ok(!JSON.stringify(claims).includes("192.0.2.8"));
  } finally { if(previous===undefined) delete process.env.VERCEL; else process.env.VERCEL=previous; }
});

test("run journal requires its own credential", () => {
  const previous = process.env.RUN_STORE_KEY; process.env.RUN_STORE_KEY="s".repeat(40);
  try {
    assert.equal(journalAuthorized({headers:{authorization:"Bearer "+"s".repeat(40)}}),true);
    assert.equal(journalAuthorized({headers:{authorization:"Bearer relay-key"}}),false);
  } finally { if(previous===undefined) delete process.env.RUN_STORE_KEY; else process.env.RUN_STORE_KEY=previous; }
});

test("two offline tabs preserve divergent edits in the shared database", async () => {
  globalThis.indexedDB = indexedDB;
  const first = await import('../src/lib/chat-cache.js?tab=first');
  const second = await import('../src/lib/chat-cache.js?tab=second');
  const chat={id:'shared',title:'Original',messages:[],updated:1};
  await first.saveChatCache('two-tabs',{chats:[chat],base:{},deleted:[]});
  await second.loadChatCache('two-tabs');
  await first.saveChatCache('two-tabs',{chats:[{...chat,title:'First edit'}],base:{},deleted:[]});
  await second.saveChatCache('two-tabs',{chats:[{...chat,title:'Second edit'}],base:{},deleted:[]});
  const saved=await second.loadChatCache('two-tabs');
  assert.equal(saved.chats.length,2);
  assert.ok(saved.chats.some(chat=>chat.title.startsWith('First edit')));
  assert.ok(saved.chats.some(chat=>chat.title==='Second edit'));
});
