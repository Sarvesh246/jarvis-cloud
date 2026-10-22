import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { percentile } from '../evaluation/metrics.js';

export function summarizeTraces(records) {
  const layers = {};
  const valid = records.filter(row => row?.kind === 'vaelo.trace' && row.schema === 1 && ['api','web-relay','relay','browser'].includes(row.layer));
  const stats = values => { const clean = values.filter(value => Number.isFinite(value) && value >= 0);
    return { n: clean.length, median_ms: percentile(clean,.5), p95_ms: percentile(clean,.95) }; };
  for (const layer of ['api','web-relay','relay','browser']) {
    const rows = valid.filter(row => row.layer === layer);
    const result = layers[layer] = { samples: rows.length, total: stats(rows.map(row => row.total_ms)), outcomes: {}, routes: {}, counts: {}, spans: {}, marks: {} };
    for (const row of rows) {
      const outcome = ['ended','cut','left','missing','error','complete','completed','restarted','stopped','stopped_or_detached','detached','stopped_before_request','running'].includes(row.outcome) ? row.outcome : 'unknown';
      result.outcomes[outcome] = (result.outcomes[outcome] || 0) + 1;
      if (['hermes','weather','router','openrouter','guest'].includes(row.route)) result.routes[row.route] = (result.routes[row.route] || 0) + 1;
      for (const [name, count] of Object.entries(row.counts || {})) {
        if (/^[a-z_]{1,64}$/.test(name) && Number.isSafeInteger(count) && count >= 0) result.counts[name] = (result.counts[name] || 0) + count;
      }
    }
    for (const [field, key] of [['spans_ms','spans'],['marks_ms','marks']]) {
      const names = new Set(rows.flatMap(row => Object.keys(row[field] || {})));
      for (const name of names) {
        if (/^[a-z_]{1,64}$/.test(name)) result[key][name] = stats(rows.map(row => row[field]?.[name]));
      }
    }
  }
  const runs = new Map();
  for (const row of valid) {
    if (typeof row.run !== 'string' || !/^[a-f0-9-]{36}$/.test(row.run)) continue;
    if (!runs.has(row.run)) runs.set(row.run,new Set());
    runs.get(row.run).add(row.layer);
  }
  return { schema: 1, records: valid.length, layers,
    correlated_runs: [...runs.values()].filter(layers => ['api','relay','browser'].every(layer=>layers.has(layer))).length,
    caveats: ['API rows represent follow attempts; relay rows represent durable runs; browser rows represent local follow sessions.',
      'Durations overlap. Never add tool, upstream-stream and total durations or subtract clocks across hosts.',
      'Hermes/provider internal queueing is not independently exposed. Upstream-open includes time to HTTP headers; first reasoning is an observed event, not a measure of all reasoning.',
      'Next-frame browser marks are scheduling proxies, not proof of paint or rich-render completion. Missing marks and unfinished tools remain unknown.'] };
}

async function main() {
  const [out, ...files] = process.argv.slice(2);
  if (!out || !files.length) throw Error('Usage: node scripts/trace-report.mjs output.json trace.jsonl [...]');
  const records = [];
  for (const file of files) {
    const input = await readFile(file,'utf8');
    if (input.length > 20_000_000) throw Error('Trace export too large; split it into bounded files.');
    try { const parsed = JSON.parse(input); records.push(...(Array.isArray(parsed) ? parsed : [parsed])); }
    catch {
      for (const line of input.split('\n')) {
        try { records.push(JSON.parse(line)); } catch { /* ignore non-JSON platform log lines */ }
      }
    }
  }
  const report = summarizeTraces(records);
  await writeFile(out, JSON.stringify(report,null,2) + '\n');
  if (!report.records) { console.error('No supported trace records were found.'); process.exitCode = 1; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode=1; });
}
