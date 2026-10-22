import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { readEvents } from '../src/stream.js';
import { checkAnswer, summarize } from '../evaluation/metrics.js';
import { comprehensiveCases } from '../evaluation/comprehensive.js';
import { visualCases } from '../evaluation/visual-cases.js';

export async function runCase(item, { origin, headers, request = fetch, timeoutMs = 90000, captureAnswers = false }) {
  const runId = randomUUID();
  const began = performance.now();
  const row = { case: item.id, capability: item.capability, run: runId, outcome: 'incomplete',
    first_answer_ms: null, headers_ms: null, total_ms: null, retries: 0, tools: 0, tool_names: [] };
  let answer = '', completed = false;
  const deadline = AbortSignal.timeout(timeoutMs);
  const conversationId = randomUUID();
  const body = { conversationId, runId, messages: item.messages, research: Boolean(item.research) };
  let after = -1, started = false;
  try {
    // Reconnect the same durable run. Never submit a second generation after
    // an ambiguous POST failure; timeout cleanup stops the original id.
    while (!deadline.aborted && !completed) {
      const response = await request(started ? `${origin}/api/chat?run=${runId}&after=${after}` : `${origin}/api/chat`, {
        method: started ? 'GET' : 'POST', headers, signal: deadline,
        ...(!started && { body: JSON.stringify(body) }),
      });
      row.headers_ms ??= Math.round(performance.now() - began);
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        row.outcome = `http_${response.status}`;
        break;
      }
      started = true;
      await readEvents(response.body, (name, data, id) => {
        if (id !== undefined) {
          const seq = Number(id);
          if (!Number.isInteger(seq) || seq <= after) return;
          after = seq;
        }
        if (name === 'jarvis.error' || name === 'jarvis.stopped') {
          row.error_code = /^[a-z_]{1,64}$/.test(data?.code || '') ? data.code : 'unspecified';
          if (Number.isInteger(data?.status)) row.error_status = data.status;
          row.outcome = name === 'jarvis.stopped' ? 'stopped' : 'error';
          throw new Error('terminal_event');
        }
        if (name === 'jarvis.retry') { row.retries++; answer = ''; }
        if (name === 'hermes.tool.progress' && data?.status !== 'completed') {
          row.tools++;
          const tool=data.tool || data.tool_name || data.name || data.function_name;
          if(['python_verify','javascript_verify','calculate','date_difference','evaluate_constraints','weather_forecast','web_search','web_extract','image_gen'].includes(tool) && !row.tool_names.includes(tool)) row.tool_names.push(tool);
        }
        const content = data?.choices?.[0]?.delta?.content;
        if (typeof content === 'string' && content.trim()) row.first_answer_ms ??= Math.round(performance.now() - began);
        if (typeof content === 'string') answer += content;
        if (answer.length > 2_000_000) throw new Error('answer_limit');
        if (name === 'jarvis.complete') {
          completed = true;
          if (data?.timing) row.relay_timing = Object.fromEntries(['totalMs','firstAnswerMs','queueMs'].filter(key=>Number.isFinite(data.timing[key])).map(key=>[key,data.timing[key]]));
          if(data?.degraded === true) row.degraded = true;
        }
      });
      if (!completed) {
        row.retries++;
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => { deadline.removeEventListener('abort', abort); resolve(); }, 250);
          function abort() { clearTimeout(timer); reject(new Error('timeout')); }
          deadline.addEventListener('abort', abort, { once: true });
        });
      }
    }
    if (completed) row.outcome = answer.trim() ? 'complete' : 'empty';
  } catch {
    if (deadline.aborted) row.outcome = 'timeout';
    else if (row.outcome === 'incomplete') row.outcome = 'transport_error';
  } finally {
    if (deadline.aborted && !completed) row.outcome = 'timeout';
    row.total_ms = Math.round(performance.now() - began);
    if (!completed) {
      try {
        const stopped = await request(`${origin}/api/stop`, { method: 'POST', headers,
          body: JSON.stringify({ runId }), signal: AbortSignal.timeout(10000) });
        row.cleanup = stopped.ok && (await stopped.json()).stopped === true ? 'stop_requested' : 'stop_failed';
      } catch { row.cleanup = 'stop_failed'; }
    }
  }
  row.answer_sha256 = createHash('sha256').update(answer).digest('hex');
  row.answer_chars = answer.length;
  row.quality = checkAnswer(answer, item.checks);
  row.quality.passed = row.outcome === 'complete' && !row.degraded && row.quality.passed;
  if(item.checks?.requiresTool) {
    const toolPresent = row.tool_names.includes(item.checks.requiresTool);
    row.quality.passed = row.outcome === 'complete' && !row.degraded && toolPresent &&
      (row.quality.checks === 0 ? Boolean(answer.trim()) : row.quality.passed);
    row.quality.checks++;
  }
  if (captureAnswers) row.answer_for_review = answer.slice(0, 12000);
  return row;
}

export async function main() {
  const args = process.argv.slice(2);
  const option = (name, fallback) => { const at = args.indexOf(name); return at < 0 ? fallback : args[at + 1]; };
  const origin = new URL(option('--origin', 'https://vaelochat.vercel.app')).origin;
  if (!origin.startsWith('https://') && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) throw new Error('Use HTTPS or localhost.');
  const mode = option('--mode', 'guest');
  if (!['guest', 'signed-in'].includes(mode)) throw new Error('Mode must be guest or signed-in.');
  const repeat = Number(option('--repeat', '1'));
  const timeoutMs = Number(option('--timeout-ms', '90000'));
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > 20 || !Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > 900000) throw new Error('Invalid repeat or timeout.');
  const suite=option('--suite','smoke');
  if(!['smoke','comprehensive','visual'].includes(suite)) throw Error('Unknown evaluation suite.');
  const seed=Number(option('--seed','731'));
  if(!Number.isInteger(seed)||seed<0||seed>4294967295) throw Error('Seed must be an unsigned 32-bit integer.');
  const cases = suite==='visual'?await visualCases():suite==='comprehensive'?comprehensiveCases(seed):
    JSON.parse(await readFile(new URL('../evaluation/cases.json', import.meta.url), 'utf8'));
  const chosen=option('--cases',suite!=='smoke'?cases.slice(0,4).map(item=>item.id).join(','):'greeting,arithmetic,rewrite,context-recall');
  const ids = chosen==='all'?cases.map(item=>item.id):chosen.split(',');
  for (const id of ids) if (!cases.some(item => item.id === id)) throw new Error(`Unknown case: ${id}`);
  const selected = cases.filter(item => ids.includes(item.id));
  if (mode === 'guest' && selected.filter(item => !item.manual).length * repeat > 18) throw new Error('Keep guest batches below 19 requests; retries also consume quota.');
  const report = { schema: 1, environment: origin, mode, source_revision: option('--revision', 'unspecified'), deployed_revision: 'unverified',
    case_set_sha256:createHash('sha256').update(JSON.stringify(selected)).digest('hex'),suite,seed,
    recorded_at: new Date().toISOString(), rows: [], skipped: [], summary: {} };
  const out = resolve(option('--out', 'evaluation-results/baseline.json'));
  await mkdir(dirname(out), { recursive: true });
  const save = async () => {
    report.summary = summarize(report.rows);
    report.by_capability = Object.fromEntries([...new Set(report.rows.map(row => row.capability))].map(capability => [capability, summarize(report.rows.filter(row => row.capability === capability))]));
    await writeFile(out, JSON.stringify(report, null, 2) + '\n');
  };
  const jar = new Map();
  function cookies(response) {
    for (const value of response.headers.getSetCookie()) {
      const pair = value.split(';', 1)[0], at = pair.indexOf('=');
      jar.set(pair.slice(0, at), pair.slice(at + 1));
    }
  }
  if (mode === 'signed-in') {
    if (!process.env.VAELO_BENCH_COOKIE) throw new Error('Provide VAELO_BENCH_COOKIE for an isolated test account. Do not put credentials in arguments.');
    for (const pair of process.env.VAELO_BENCH_COOKIE.split(';')) {
      const at = pair.indexOf('=');
      if (at > 0) jar.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
    }
  }
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const session = await fetch(`${origin}/api/session`, { headers: { Cookie: cookie() }, signal: AbortSignal.timeout(20000) });
  if (!session.ok) throw new Error('Session endpoint unavailable.');
  cookies(session);
  const state = await session.json();
  const headers = () => ({ 'Content-Type': 'application/json', Origin: origin, Cookie: cookie(), 'X-CSRF-Token': state.csrf });
  if (mode === 'signed-in' && (!state.user || state.user.guest)) throw new Error('Signed-in test account session required.');
  if (mode === 'guest') {
    const login = await fetch(`${origin}/api/login`, { method: 'POST', headers: headers(), body: JSON.stringify({ guest: true }), signal: AbortSignal.timeout(20000) });
    if (!login.ok) throw new Error('Guest session unavailable.');
    cookies(login); await login.body?.cancel();
  }
  async function revision() {
    try {
      const status=await fetch(`${origin}/api/status?capabilities=1`,{headers:headers(),signal:AbortSignal.timeout(20000)});
      const data=await status.json();
      return status.ok && /^[a-f0-9]{40}$/.test(data.revision||'')?
        {web:data.revision,backend:/^[a-f0-9]{40}$/.test(data.backend_revision||'')?data.backend_revision:null,
         backend_protocol:data.backend_protocol??null}:null;
    } catch {return null;}
  }
  const initialRevision=await revision();
  report.deployed_revision=initialRevision?.web||'unverified';
  report.backend_revision=initialRevision?.backend||'unverified';
  report.backend_protocol=initialRevision?.backend_protocol??null;
  for (const item of selected) {
    if (item.manual || (item.signedIn && mode === 'guest')) {
      report.skipped.push({ case: item.id, reason: item.manual ? 'manual_review_required' : 'signed_in_required', review: item.review });
      continue;
    }
    for (let i = 0; i < repeat; i++) {
      const row = await runCase(item, { origin, headers: headers(), timeoutMs, captureAnswers: args.includes('--include-answers') });
      report.rows.push(row);
      if(args.includes('--relay-traces') && process.env.VAELO_BENCH_SUB && process.env.JARVIS_API_KEY && process.env.JARVIS_API_URL?.startsWith('https://')) {
        try {
          const response=await fetch(`${process.env.JARVIS_API_URL.replace(/\/$/,'')}/vaelo/runs/${row.run}/trace`,{
            headers:{Authorization:`Bearer ${process.env.JARVIS_API_KEY}`,'X-Hermes-Session-Key':`web:${process.env.VAELO_BENCH_SUB}`},signal:AbortSignal.timeout(10000)});
          const trace=await response.json();
          if(response.ok && trace.kind==='vaelo.trace' && trace.run===row.run) row.relay_trace=trace;
          else row.relay_trace_status='unavailable';
        } catch {row.relay_trace_status='unavailable';}
      }
      await save();
      console.info(`${item.id}: ${row.outcome}; first=${row.first_answer_ms ?? '-'}ms total=${row.total_ms}ms checks=${row.quality.passed}`);
      if (row.cleanup === 'stop_failed') throw new Error('Stop was not confirmed; halt the batch to avoid overlapping generations.');
    }
  }
  const finalRevision=await revision();
  report.deployment_stable=Boolean(initialRevision && finalRevision?.web===initialRevision.web);
  report.backend_deployment_stable=Boolean(initialRevision?.backend && finalRevision?.backend===initialRevision.backend);
  if(!report.deployment_stable) report.deployed_revision='unverified';
  if(!report.backend_deployment_stable) report.backend_revision='unverified';
  await save();
  console.info(JSON.stringify(report.summary));
  if (report.summary.failures || report.summary.automated_passes !== report.summary.completed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error('Baseline could not finish. Check connectivity, session, quota, arguments, and partial results. Credentials and responses are never printed.'); process.exitCode = 1; });
}
