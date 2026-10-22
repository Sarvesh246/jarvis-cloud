import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { requestTrace } from '../shared/request-trace.js';
import { checkAnswer, percentile, summarize } from '../evaluation/metrics.js';
import { runCase } from '../scripts/baseline.mjs';
import { summarizeTraces } from '../scripts/trace-report.mjs';

test('trace report correlates run ids without subtracting host clocks or inventing missing stages', () => {
  const run = '123e4567-e89b-12d3-a456-426614174000';
  const row = {schema:1,kind:'vaelo.trace',run,total_ms:10,spans_ms:{memory:3},marks_ms:{first:2}};
  const report = summarizeTraces([{...row,layer:'api'}, {...row,layer:'relay'}, {...row,layer:'browser'}, {kind:'other',secret:'no'}]);
  assert.equal(report.correlated_runs,1);
  assert.equal(report.layers.api.spans.memory.median_ms,3);
  assert.equal(report.layers.api.outcomes.unknown,1);
  assert.equal(report.layers.relay.marks.first.p95_ms,2);
  assert.equal(report.layers.api.spans.provider_queue,undefined);
  assert.doesNotMatch(JSON.stringify(report), /secret/);
});

test('trace records failed spans without swallowing errors and isolates sink failures', async () => {
  let now = 0;
  const trace = requestTrace('run', 'api', { clock: () => now, report: () => { throw Error('sink'); } });
  await assert.rejects(trace.span('memory', async () => { now = 42; throw Error('storage'); }), /storage/);
  trace.mark('first'); now = 65; trace.mark('first'); trace.count('retry');
  const row = trace.finish('error');
  assert.equal(row.spans_ms.memory, 42);
  assert.equal(row.marks_ms.first, 42);
  assert.equal(row.total_ms, 65);
  assert.equal(row.counts.retry, 1);
  assert.equal(trace.finish('complete'), undefined);
  assert.doesNotMatch(JSON.stringify(row), /storage|sink/);
});

test('baseline suite covers all six capabilities with explicit human review requirements', async () => {
  const cases = JSON.parse(await readFile(new URL('../evaluation/cases.json', import.meta.url)));
  assert.deepEqual([...new Set(cases.map(row => row.capability))].sort(), ['context','memory','routing','tools','ui','verification']);
  assert.equal(new Set(cases.map(row => row.id)).size, cases.length);
  assert.ok(cases.every(row => row.review && (row.manual || row.messages?.length)));
  assert.ok(cases.filter(row => row.manual).length >= 3);
});

test('quality checks do not turn numerical answers into proof of execution or rendering', () => {
  const checked = checkAnswer('391', { exact: '391' });
  assert.equal(checked.passed, true);
  assert.equal(checked.semanticReview, 'unverified');
  assert.equal(checkAnswer('', {}).passed, false);
  assert.equal(checkAnswer('392', { exact: '391' }).passed, false);
  assert.equal(percentile([], .95), null);
  assert.equal(percentile([1, 2, 100], .95), 100);
  const report = summarize([{outcome:'complete', first_answer_ms:2,total_ms:4,quality:checked}, {outcome:'timeout',first_answer_ms:null,total_ms:90000}]);
  assert.equal(report.failures, 1);
  assert.equal(report.total.n, 1);
  assert.equal(report.failure_latency.p95_ms, 90000);
  assert.equal(report.rendering, 'unverified');
});

const frame = (id, name, data) => `id: ${id}\nevent: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
const item = { id:'arithmetic', capability:'routing', messages:[{role:'user',content:'17 * 23'}],checks:{exact:'391'} };

test('benchmark resumes one run, deduplicates replay, and waits for explicit completion', async () => {
  const calls = [];
  const request = async (url, options) => {
    calls.push([url, options]);
    return new Response(calls.length === 1
      ? frame(0, 'message', {choices:[{delta:{content:'391'}}]})
      : frame(0, 'message', {choices:[{delta:{content:'391'}}]}) + frame(1, 'jarvis.complete', {ok:true}));
  };
  const result = await runCase(item, { origin:'https://example.test',headers:{},request,timeoutMs:2000 });
  assert.equal(calls.length, 2);
  assert.equal(calls[0][1].method, 'POST');
  assert.equal(calls[1][1].method, 'GET');
  assert.match(calls[1][0], /after=0$/);
  assert.equal(result.quality.passed, true);
  assert.equal(result.answer_chars, 3);
  assert.equal(result.outcome, 'complete');
});

test('benchmark preserves failure, asks to stop, and never grades a partial answer as complete', async () => {
  const calls = [];
  const request = async (url) => {
    calls.push(url);
    if (url.endsWith('/stop')) return Response.json({stopped:true});
    return new Response(frame(0, 'message', {choices:[{delta:{content:'391'}}]}) + frame(1, 'jarvis.error', {message:'failed'}));
  };
  const row = await runCase(item, {origin:'https://example.test',headers:{},request});
  assert.equal(row.outcome, 'error');
  assert.equal(row.cleanup, 'stop_requested');
  assert.equal(calls.length, 2);
  assert.equal(summarize([row]).automated_passes, 0);
});

test('a correct number is insufficient when execution through a named tool is required',async()=>{
  const executable={...item,checks:{exact:'391',requiresTool:'python_verify'}};
  const request=async()=>new Response(frame(0,'message',{choices:[{delta:{content:'391'}}]})+frame(1,'jarvis.complete',{ok:true}));
  const row=await runCase(executable,{origin:'https://example.test',headers:{},request});
  assert.equal(row.outcome,'complete');assert.equal(row.quality.passed,false);
  const withTool=async()=>new Response(frame(0,'hermes.tool.progress',{tool:'python_verify',status:'running'})+frame(1,'message',{choices:[{delta:{content:'391'}}]})+frame(2,'jarvis.complete',{ok:true}));
  assert.equal((await runCase(executable,{origin:'https://example.test',headers:{},request:withTool})).quality.passed,true);
});

test('benchmark deadline cancels the stream and requests cleanup', async () => {
  let cancelled = false;
  const request = async url => {
    if (url.endsWith('/stop')) return Response.json({stopped:true});
    return new Response(new ReadableStream({ cancel() { cancelled = true; } }));
  };
  // A real fetch aborts its body; emulate that transport contract here.
  const aborting = async (url, options) => {
    if (url.endsWith('/stop')) return request(url);
    return new Response(new ReadableStream({
      start(controller) { options.signal.addEventListener('abort', () => { cancelled = true; controller.error(options.signal.reason); }, {once:true}); },
    }));
  };
  const row = await runCase(item, {origin:'https://example.test', headers:{}, request:aborting, timeoutMs:30});
  assert.equal(row.outcome, 'timeout');
  assert.equal(row.cleanup, 'stop_requested');
  assert.equal(cancelled, true);
});
