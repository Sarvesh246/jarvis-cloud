import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { LIMITS, chatInput, clipReply as serverClip, feedInput, followFeed, notifyFeed, resumeInput, streamChat } from "../server/chat.js";
import { probeBackend } from "../server/backend-readiness.js";
import { readEvents } from "../src/stream.js";
import { clipReply, fitHistory, wireMessage } from "../src/lib/attachments.js";
import { automaticSamples } from './fixtures/automatic-samples.js';
import { richPresentationFor } from '../shared/rich-ui-guidance.js';
import {CONTEXT_POLICY} from '../shared/context-policy.js';

const conversationId = "123e4567-e89b-12d3-a456-426614174000";

test("a very long earlier reply no longer makes the next message invalid", () => {
  const program = "line of code\n".repeat(20000);
  const input = chatInput({
    conversationId,
    messages: [
      { role: "user", content: "Write the whole app." },
      { role: "assistant", content: program },
      { role: "user", content: "Now add tests." },
    ],
  });
  const reply = input.messages[1].content;
  assert.equal(reply.length, LIMITS.replyChars);
  assert.ok(reply.startsWith("line of code"));
  assert.match(reply, /omitted to save space/);
  assert.match(input.messages[2].content, /^Now add tests\./);
});

test("the page and the proxy clip a reply identically, so it is never clipped twice", () => {
  const long = "a".repeat(30000) + "END";
  const sent = wireMessage({ role: "assistant", content: long }).content;
  assert.equal(sent, clipReply(long));
  assert.equal(serverClip(sent), sent);
  assert.ok(sent.endsWith("END"));
});

test("a conversation with several long code replies still sends its recent turns", () => {
  const turns = Array.from({ length: 13 }, (_, i) =>
    wireMessage({ role: i % 2 ? "assistant" : "user", content: i % 2 ? "x".repeat(40000) : "next step" }),
  );
  const { messages } = fitHistory(turns);
  assert.ok(messages.length >= 6);
  assert.doesNotThrow(() => chatInput({ conversationId, messages }));
});

test("a sleeping, booting or slow server reads as not ready, never as an error", async () => {
  const answers = [
    () => new Response("<html>waking</html>", { status: 502 }),
    () => Response.json({ status: "setup_required" }),
    () => new Response("<html>loading</html>", { status: 200 }),
    () => Promise.reject(new TypeError("fetch failed")),
  ];
  for (const answer of answers)
    assert.equal(await probeBackend("https://backend.example", { request: answer }), false);
  assert.equal(
    await probeBackend("https://backend.example", { request: () => Response.json({ status: "ok" }) }),
    true,
  );
});

function fakeExchange() {
  const res = new EventEmitter();
  res.chunks = [];
  res.destroyed = false;
  res.setHeader = () => {};
  res.write = (chunk) => (res.chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString()), true);
  res.end = () => {
    res.ended = true;
  };
  const req = new EventEmitter();
  const events = () =>
    res.chunks
      .join("")
      .split("\n\n")
      .map((frame) => frame.split("\n").filter((line) => !line.startsWith("id:")))
      .filter((lines) => lines[0]?.startsWith("event:"))
      .map(([head, data]) => ({ name: head.slice(7), data: JSON.parse(data.slice(6)) }));
  return { req, res, events };
}

const cfg = { backend: "https://backend.example", apiKey: "k".repeat(40) };
const user = { sub: "owner", name: "Owner" };
const runId = "9f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f";
const input = { conversationId, runId, messages: [{ role: "user", content: "hi" }] };

test("slow readers do not accumulate close listeners while chat and feed streams drain", async () => {
  for (const feed of [false, true]) {
    const { req, res } = fakeExchange();
    let writes = 0;
    res.write = () => {
      writes++;
      setImmediate(() => res.emit("drain"));
      return false;
    };
    const bytes = new TextEncoder().encode(': keepalive\n\n');
    const request = async () => new Response(new ReadableStream({
      start(controller) {
        for (let i = 0; i < 20; i++) controller.enqueue(bytes);
        controller.close();
      },
    }));
    if (feed) await followFeed(req, res, cfg, user, -1, request);
    else await streamChat(req, res, cfg, user, { ...input, after: -1 }, request);
    assert.ok(writes >= 20);
    for (const name of ["close", "drain", "error"]) assert.equal(res.listenerCount(name), 0, name);
  }
});

test("a feed deadline releases a stalled reader and cancels its upstream stream", async () => {
  const { req, res } = fakeExchange();
  let cancelled = false;
  res.write = () => false; // no drain, and the socket stays open
  const request = async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode(': keepalive\n\n')); },
    cancel() { cancelled = true; },
  }));
  await followFeed(req, res, cfg, user, -1, request, { followMs: 25 });
  assert.equal(cancelled, true);
  assert.equal(res.ended, true);
  for (const name of ["close", "drain", "error"]) assert.equal(res.listenerCount(name), 0, name);
});

test("a chat deadline releases a stalled reader so the reply can reconnect", async () => {
  const { req, res, events } = fakeExchange();
  let cancelled = false;
  res.write = chunk => {
    res.chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
    return false;
  };
  const request = async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode(': keepalive\n\n')); },
    cancel() { cancelled = true; },
  }));
  await streamChat(req, res, cfg, user, { ...input, after: -1 }, request, { followMs: 25 });
  assert.equal(cancelled, true);
  assert.equal(res.ended, true);
  assert.ok(events().some(event => event.name === "jarvis.resume"));
  for (const name of ["close", "drain", "error"]) assert.equal(res.listenerCount(name), 0, name);
});

/* A stand-in for the relay in front of Hermes: it accepts runs and serves
   their numbered frames, ending with ": end" once the run is over. */
function fakeRelay({ frames = ['id: 0\nevent: jarvis.complete\ndata: {"ok":true}'], end = true, health = () => true, start = 202, events } = {}) {
  const calls = [];
  const request = async (url, options = {}) => {
    calls.push({ url, method: options.method || "GET", options });
    if (url.endsWith("/health")) return health() ? Response.json({ status: "ok" }) : new Response("", { status: 502 });
    if (url.endsWith("/")) return new Response("waking");
    if (url.endsWith("/vaelo/runs")) return new Response(JSON.stringify({ run_id: runId }), { status: start });
    if (url.includes("/events")) {
      if (events) return events(url, options);
      return new Response(frames.map((frame) => `${frame}\n\n`).join("") + (end ? ": end\n\n" : ""));
    }
    return new Response("", { status: 404 });
  };
  return { request, calls };
}

test("a reply that outlasts the function tells the page to pick it back up", async () => {
  const { req, res, events } = fakeExchange();
  const { request } = fakeRelay({
    events: (url, options) =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('id: 0\ndata: {"choices":[{"delta":{"content":"Part one"}}]}\n\n'));
            options.signal.addEventListener("abort", () => controller.error(options.signal.reason));
          },
        }),
      ),
  });
  await streamChat(req, res, cfg, user, input, request, { followMs: 50 });
  assert.match(res.chunks.join(""), /Part one/);
  const names = events().map((e) => e.name);
  assert.equal(names.at(-1), "jarvis.resume");
  assert.ok(!names.includes("jarvis.error"));
  assert.ok(res.ended);
});

test("waking is only announced when the server is actually asleep", async () => {
  const run = async (healthy) => {
    const { req, res, events } = fakeExchange();
    let probes = 0;
    const { request } = fakeRelay({ health: () => probes++ || healthy });
    await streamChat(req, res, cfg, user, input, request);
    return events().filter((e) => e.name === "jarvis.status").map((e) => e.data.message);
  };
  assert.ok(!(await run(true)).some((message) => /wak/i.test(message)));
  assert.ok((await run(false)).some((message) => /Waking/.test(message)));
});

test("a reply is started on the relay under its own id, then followed from the start", async () => {
  const { req, res, events } = fakeExchange();
  const { request, calls } = fakeRelay({
    frames: ['id: 0\ndata: {"choices":[{"delta":{"content":"Hello"}}]}', 'id: 1\nevent: jarvis.complete\ndata: {"ok":true}'],
  });
  await streamChat(req, res, cfg, user, input, request);
  const start = calls.find((call) => call.url.endsWith("/vaelo/runs"));
  assert.equal(JSON.parse(start.options.body).id, runId);
  assert.ok(calls.some((call) => call.url.endsWith(`/vaelo/runs/${runId}/events?after=-1`)));
  assert.match(res.chunks.join(""), /id: 0\n/);
  assert.equal(events().at(-1).name, "jarvis.complete");
});

test('a real direct prompt with full saved preferences fits the shared relay budget',async()=>{
  const {req,res}=fakeExchange();const {request,calls}=fakeRelay();
  const profiled=chatInput({conversationId,messages:[{role:'user',content:'Hi'}]});
  profiled.memory={notes:Array.from({length:14},()=> 'Preference '.repeat(25)),canNote:true};
  await streamChat(req,res,cfg,user,profiled,request);
  const payload=JSON.parse(calls.find(call=>call.method==='POST').options.body);
  assert.ok(payload.fast.length>8000,'fixture must cover the previously rejected valid prompt');
  assert.ok(payload.fast.length<=CONTEXT_POLICY.fastSystemChars);
  assert.equal(payload.tier,'quick');
});

test('implicit rich presentation instructions reach normal and direct routes in a single run', async () => {
  for (const fast of [false, true]) {
    const {req, res} = fakeExchange();
    const {request, calls} = fakeRelay();
    await streamChat(req, res, cfg, user, {...input, fast, messages:[{role:'user', content:'Split the bill between three people: food $60, transport $15.'}]}, request);
    const starts = calls.filter(call => call.url.endsWith('/vaelo/runs'));
    assert.equal(starts.length, 1);
    const body = JSON.parse(starts[0].options.body);
    const system = body.messages.find(message => message.role === 'system').content;
    assert.match(system, /Choose these cards automatically/);
    assert.match(system, /receipt: currency:ISO4217/);
    if (fast) assert.match(body.fast, /Choose these cards automatically/);
  }
});

test('natural rich-style intent survives normal, direct and guest routes without an extra generation', async () => {
  const examples=new Map();
  for(const [,prompt] of automaticSamples) {const type=richPresentationFor(prompt);if(type && !examples.has(type))examples.set(type,prompt);}
  for(const [type,prompt] of examples) {
    for(const mode of ['normal','direct','guest']) {
      const {req,res}=fakeExchange();const {request,calls}=fakeRelay();
      await streamChat(req,res,cfg,mode==='guest'?{...user,guest:true}:user,{...input,fast:mode==='direct',messages:[{role:'user',content:prompt}]},request);
      const starts=calls.filter(call=>call.url.endsWith('/vaelo/runs'));
      assert.equal(starts.length,1,type+'/'+mode);
      const body=JSON.parse(starts[0].options.body);
      const system=body.messages.find(m=>m.role==='system').content;
      assert.ok(system.includes('"type":"'+type+'"'),type+'/'+mode);
      if(mode==='direct') assert.ok(body.fast.includes('"type":"'+type+'"'),type+'/fast');
    }
  }
  assert.equal(examples.size,12);
});

test("picking a reply back up never starts a new run", async () => {
  const { req, res } = fakeExchange();
  const { request, calls } = fakeRelay();
  await streamChat(req, res, cfg, user, { runId, after: 41 }, request);
  assert.ok(!calls.some((call) => call.url.endsWith("/vaelo/runs")));
  assert.ok(!calls.some((call) => call.url.endsWith("/health")));
  assert.ok(calls.some((call) => call.url.endsWith("/events?after=41")));
});

test("the page leaving never stops the reply", async () => {
  const { req, res } = fakeExchange();
  const { request, calls } = fakeRelay({
    events: (url, options) =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(": open\n\n"));
            options.signal.addEventListener("abort", () => controller.error(options.signal.reason));
          },
        }),
      ),
  });
  const done = streamChat(req, res, cfg, user, input, request);
  await new Promise((resolve) => setTimeout(resolve, 20));
  res.emit("close");
  await done;
  assert.ok(!calls.some((call) => call.url.includes("/stop")));
});

test("a reply the relay no longer has is reported, not waited on", async () => {
  const { req, res, events } = fakeExchange();
  const { request } = fakeRelay({ events: () => new Response("", { status: 404 }) });
  await streamChat(req, res, cfg, user, { runId, after: 3 }, request);
  assert.equal(events().at(-1).data.code, "run_missing");
});

test("a relay connection that breaks mid-reply sends the page back for the rest", async () => {
  const { req, res, events } = fakeExchange();
  const { request } = fakeRelay({ frames: ['id: 0\ndata: {"choices":[{"delta":{"content":"Partial"}}]}'], end: false });
  await streamChat(req, res, cfg, user, input, request);
  assert.match(res.chunks.join(""), /Partial/);
  assert.equal(events().at(-1).name, "jarvis.resume");
});

test("a relay connection cut partway through a frame never sends half of it", async () => {
  const { req, res } = fakeExchange();
  const whole = 'id: 0\ndata: {"choices":[{"delta":{"content":"Kept"}}]}\n\n';
  const half = 'id: 1\ndata: {"choices":[{"delta":{"con';
  const { request } = fakeRelay({
    events: () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(whole + half));
            setTimeout(() => controller.error(new Error("connection reset")), 5);
          },
        }),
      ),
  });
  await streamChat(req, res, cfg, user, { runId, after: -1 }, request);
  const seen = [];
  await readEvents(new Response(res.chunks.join("")).body, (name, data, id) => seen.push({ name, id }));
  // The half frame is left for the next request, which asks after frame 0.
  assert.deepEqual(seen, [
    { name: "message", id: "0" },
    { name: "jarvis.resume", id: undefined },
  ]);
});

test("damaged relay UTF-8 is replayed instead of acknowledged as replacement text", async () => {
  const encoder = new TextEncoder();
  const kept = 'id: 0\ndata: {"choices":[{"delta":{"content":"Kept café"}}]}\n\n';
  const prefix = 'id: 1\ndata: {"choices":[{"delta":{"content":"';
  const suffix = '"}}]}\n\nid: 2\nevent: jarvis.complete\ndata: {"ok":true}\n\n: end\n\n';
  for (const damaged of [Uint8Array.of(0xff), Uint8Array.of(0xe2, 0x82)]) {
    const { req, res, events } = fakeExchange();
    const finiteRequest = async () => new Response(new ReadableStream({
      start(controller) {
        for (const chunk of [encoder.encode(kept), encoder.encode(prefix), damaged, encoder.encode(suffix)])
          controller.enqueue(chunk);
        controller.close();
      },
    }));
    await streamChat(req, res, cfg, user, { runId, after: -1 }, finiteRequest);
    const seen = [];
    await readEvents(new Response(res.chunks.join('')).body, (name, data, id) => seen.push({ name, data, id }));
    assert.equal(seen[0].id, '0');
    assert.equal(seen[0].data.choices[0].delta.content, 'Kept café');
    assert.ok(!seen.some(event => event.id === '1' || event.id === '2'));
    assert.equal(events().at(-1).name, 'jarvis.resume');
    assert.doesNotMatch(res.chunks.join(''), /\uFFFD/);
    // Retry the same run with clean relay bytes; no model run is created.
    const recovered = fakeExchange();
    const relay = fakeRelay({ frames: ['id: 1\ndata: {"choices":[{"delta":{"content":"Recovered 🌍"}}]}', 'id: 2\nevent: jarvis.complete\ndata: {"ok":true}'] });
    await streamChat(recovered.req, recovered.res, cfg, user, { runId, after: 0 }, relay.request);
    assert.match(recovered.res.chunks.join(''), /Recovered 🌍/);
    assert.ok(relay.calls.every(call => !call.url.endsWith('/vaelo/runs')));
  }
});

test("relay decoding preserves every split Unicode character and frame byte", async () => {
  const text = 'id: 0\ndata: {"choices":[{"delta":{"content":"café 数学 🌍 \\n```js\\nconst x = 1;\\n```"}}]}\n\nid: 1\nevent: jarvis.complete\ndata: {"ok":true}\n\n: end\n\n';
  const { req, res, events } = fakeExchange();
  await streamChat(req, res, cfg, user, { runId, after: -1 }, async () => new Response(new ReadableStream({
    start(controller) {
      for (const byte of new TextEncoder().encode(text)) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    },
  })));
  assert.equal(res.chunks.join(''), text);
  assert.equal(events().at(-1).name, 'jarvis.complete');
});

test("relay decoder rejects incomplete UTF-8 and unfinished data after an end marker", async () => {
  for (const tail of [Uint8Array.of(0xe2, 0x82), new TextEncoder().encode('id: 2\ndata: {')]) {
    const { req, res, events } = fakeExchange();
    await streamChat(req, res, cfg, user, { runId, after: -1 }, async () =>
      new Response(new Blob([': end\n\n', tail])));
    assert.equal(events().at(-1).name, 'jarvis.resume');
    assert.doesNotMatch(res.chunks.join(''), /id: 2/);
  }
});

test("rejecting corrupt relay bytes cancels the reader and releases response listeners", async () => {
  const { req, res, events } = fakeExchange();
  let cancelled = false;
  await streamChat(req, res, cfg, user, { runId, after: -1 }, async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(Uint8Array.of(0xff)); },
    cancel() { cancelled = true; },
  })));
  assert.equal(cancelled, true);
  assert.equal(res.ended, true);
  assert.equal(events().at(-1).name, 'jarvis.resume');
  for (const name of ['close', 'drain', 'error']) assert.equal(res.listenerCount(name), 0);
  for (const name of ['aborted', 'error']) assert.equal(req.listenerCount(name), 0);
});

test("resuming takes a run id and a position, nothing else", () => {
  assert.deepEqual(resumeInput({ run: runId, after: "12" }), { runId, after: 12 });
  assert.deepEqual(resumeInput({ run: runId }), { runId, after: -1 });
  assert.throws(() => resumeInput({ run: "../../etc", after: "1" }), /resumed/);
  assert.throws(() => resumeInput({ run: runId, after: "-5" }), /resumed/);
});

test("everyday replies ask for brief thinking; research and thorough keep full depth", async () => {
  const sent = async (mode) => {
    const { req, res } = fakeExchange();
    const { request, calls } = fakeRelay();
    await streamChat(req, res, cfg, user, { ...input, ...mode }, request);
    return JSON.parse(calls.find((call) => call.url.endsWith("/vaelo/runs")).options.body).model_options;
  };
  assert.deepEqual(await sent({ style: "balanced", research: false }), { reasoning_effort: "low" });
  assert.deepEqual(await sent({ style: "concise", research: false }), { reasoning_effort: "low" });
  assert.equal(await sent({ style: "thorough", research: false }), undefined);
  assert.equal(await sent({ style: "balanced", research: true }), undefined);
  // roles that weigh evidence think fully; teaching and step-by-step stay quick
  assert.equal(await sent({ style: "balanced", research: false, role: "skeptic" }), undefined);
  assert.equal(await sent({ style: "balanced", research: false, role: "advocate" }), undefined);
  assert.deepEqual(await sent({ style: "balanced", research: false, role: "tutor" }), { reasoning_effort: "low" });
  assert.deepEqual(await sent({ style: "balanced", research: false, role: "guide" }), { reasoning_effort: "low" });
});

test("a quick message offers the relay a fast route; anything else and guests never do", async () => {
  const sent = async (content, who = user, mode = {}) => {
    const { req, res } = fakeExchange();
    const { request, calls } = fakeRelay();
    const parsed = chatInput({ conversationId, runId, messages: [{ role: "user", content, mode: { style: "balanced", research: false, ...mode } }] });
    await streamChat(req, res, cfg, who, who.guest ? { ...parsed } : parsed, request);
    return JSON.parse(calls.find((call) => call.url.endsWith("/vaelo/runs")).options.body);
  };
  const greeting = await sent("hello!");
  assert.equal(greeting.model_options.reasoning_effort, "minimal");
  assert.match(greeting.fast, /^You are Vaelo/);
  assert.match(greeting.fast, /"display_name":"Owner"/);
  // the full prompt still travels, so the relay can fall back to Hermes
  assert.match(greeting.messages[0].content, /Research method/);
  assert.doesNotMatch(greeting.fast, /Research method/);
  const laptops = await sent("find the best 4 laptops under 1500 usd and compare them for gaming, engineering classes and local AI models");
  assert.equal(laptops.fast, undefined);
  assert.equal(laptops.model_options.reasoning_effort, "medium");
  assert.equal((await sent("hello!", user, { research: true })).fast, undefined);
  const guest = await sent("hello!", { sub: "guest:x", guest: true });
  assert.equal(guest.fast, undefined);
  assert.equal(guest.model_options.reasoning_effort, "minimal");
});

test("a backend that just answered is not health-checked again before the next message", async () => {
  const { request, calls } = fakeRelay();
  for (let i = 0; i < 3; i += 1) {
    const { req, res, events } = fakeExchange();
    await streamChat(req, res, cfg, user, input, request);
    assert.equal(events().at(-1).name, "jarvis.complete");
  }
  assert.equal(calls.filter((call) => call.url.endsWith("/health")).length, 1);
});

test("after a failed start the backend is checked again", async () => {
  let starts = 0;
  const relay = fakeRelay();
  const request = async (url, options) => {
    if (url.endsWith("/vaelo/runs") && starts++ === 0) return new Response("", { status: 503 });
    return relay.request(url, options);
  };
  const first = fakeExchange();
  await streamChat(first.req, first.res, cfg, user, input, request);
  assert.equal(first.events().at(-1).name, "jarvis.error");
  const second = fakeExchange();
  await streamChat(second.req, second.res, cfg, user, input, request);
  assert.equal(second.events().at(-1).name, "jarvis.complete");
  assert.equal(relay.calls.filter((call) => call.url.endsWith("/health")).length, 2);
});

test("a reply is named by the page's own id, or given one by older pages", () => {
  const base = { conversationId, messages: [{ role: "user", content: "hi" }] };
  assert.equal(chatInput({ ...base, runId }).runId, runId);
  assert.match(chatInput(base).runId, /^[a-f0-9-]{36}$/);
  assert.notEqual(chatInput({ ...base, runId: "not-a-uuid" }).runId, "not-a-uuid");
});

test("devices listen for account changes through the relay, as the signed-in person", async () => {
  const calls = [];
  const request = async (url, options = {}) => {
    calls.push({ url, method: options.method || "GET", headers: options.headers });
    if (options.method === "POST") return Response.json({ ok: true });
    return new Response('event: feed\ndata: {"seq": 4}\n\n: end\n\n', {
      headers: { "Content-Type": "text/event-stream" },
    });
  };
  const { req, res } = fakeExchange();
  await followFeed(req, res, cfg, user, feedInput({ after: "3" }), request);
  assert.equal(calls[0].url, "https://backend.example/vaelo/feed?after=3");
  assert.equal(calls[0].headers["X-Hermes-Session-Key"], "web:owner");
  assert.match(res.chunks.join(""), /"seq": 4/);
  assert.equal(res.ended, true);
  await notifyFeed(cfg, user, request);
  assert.equal(calls[1].method, "POST");
  // A sleeping cloud never fails a save.
  await notifyFeed(cfg, user, async () => { throw new TypeError("fetch failed"); });
  // Nor does it hold a listening device: it is told to check storage instead.
  await assert.rejects(
    followFeed(fakeExchange().req, fakeExchange().res, cfg, user, -1, async () => new Response("", { status: 502 })),
    { status: 503 },
  );
  assert.throws(() => feedInput({ after: "soon" }), { status: 400 });
});
