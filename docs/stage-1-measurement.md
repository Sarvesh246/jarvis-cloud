# Stage 1: latency and capability baseline

Stage 1 adds observation and a repeatable evaluation harness. It does not change model selection, reasoning budgets, retry policy, memory retrieval, or tool availability. It makes no extra model calls per user request.

## Request traces

API and relay emit JSON records with `kind: "vaelo.trace"`, `schema: 1`, the full durable run id, a layer, an outcome, monotonic durations, first-event offsets, and counters. Join layers by run id, never by subtracting clocks across hosts. The existing human-readable timing lines remain available.

| Layer | Measurements |
| --- | --- |
| API | Authorization, input/context preparation, selected workspace load, account memory load, backend readiness, run acceptance, follow duration, wake/start/resume counts and requested routing tier. Each GET resume produces a separate API record. |
| Relay | Offset to execution start, weather lookup, freshness retrieval, aggregate upstream-open and upstream-stream durations, first raw answer/reasoning receipt, route, generation attempts, fast fallbacks, upstream request count, observed tool intervals and unfinished tool count. |
| Browser | Local context preparation and location readiness, warm-up, request/headers, first answer/reasoning/event receipt, first answer state update and next animation frame, busy retries, reconnect requests and answer retries/continuations. |

Browser observation is explicitly opt-in: open Vaelo with `?diagnostics=1`, or set `sessionStorage.setItem('vaelo.diagnostics', '1')` in developer tools. Records appear in the console and a 50-record in-memory `window.__vaeloTraces` buffer. Export that array through developer tools when needed. Remove the query flag and session-storage key to disable it. No diagnostic endpoint, telemetry upload, or permanent browser log is added.

Records exclude prompts, answers, reasoning text, user identity, memory text, source URLs, tool arguments/results, tokens and credentials. Tool identifiers are kept only transiently to pair starts/ends; they are not exported. Benchmark answer capture is a separate explicit flag and should only be used with synthetic inputs and an isolated test account. Raw benchmark files live under ignored `evaluation-results/` directories.

### Measurement limits

- Upstream-open includes time until HTTP response headers, including any Hermes admission/initialization delay. Provider-internal queues and exact model computation time are not independently exposed by this boundary. Do not label the entire interval as model reasoning or cold start.
- First raw answer receipt can precede output validation. Browser next-frame timing is a scheduling proxy, not proof of paint or finished rich rendering. Missing values stay unknown. Resumed/replayed sessions must be separated from new requests when interpreting first-answer latency.
- Tool intervals are the union of observed starts/completions, so overlapping tools are not double counted. Missing or ambiguous tool ids and missing completion events limit this measurement; unfinished tools are reported, not guessed complete. Tool/stream spans overlap and must not be added together.
- Relay execution-start offset measures thread scheduling after run creation, not Hermes's internal queue. Browser warm-up and server readiness are separate observations, not proof that both delayed a particular request.
- A transport `ended` outcome means the event stream ended, not that its answer was correct. Benchmark completion requires the explicit `jarvis.complete` event and a nonempty answer.
- Run ids correlate new browser/API/relay records; browser sessions that recover into a new durable run are not merged automatically. Comparisons must identify recovery/replay cohorts.

## Repeatable evaluation

`web/evaluation/cases.json` covers all six capabilities, including corrections, exact-answer routing, research/weather, UI data preservation/math, unknown information, and honest execution claims. Persistent memory/workspace and failure-injection cases include explicit manual procedures. They are never silently marked passed by the live runner.

From `web/`:

```powershell
npm run baseline -- --cases greeting,arithmetic,rewrite,context-recall --repeat 2 --out evaluation-results/guest.json --revision <source-commit>
npm run baseline -- --cases weather,table,math,uncertainty,execution-honesty --out evaluation-results/capabilities.json
```

Guest and signed-in behavior differ. For signed-in API measurements use `--mode signed-in` and an isolated test account's cookie in the environment variable `VAELO_BENCH_COOKIE`. The runner gets the CSRF token from `/api/session`, verifies the account is signed in, and keeps credentials out of command arguments, logs and result files. Never commit session cookies. Use `--origin` for a preview or local instance and `--timeout-ms` for an explicit deadline. The runner rejects insecure nonlocal origins.

The harness submits sequentially, resumes the same run when its follow stream ends, deduplicates numbered frames, records failures/timeouts, and requests Stop for incomplete runs. It halts a batch if Stop cannot be confirmed. It never retries an ambiguous POST as a new generation. Default batches are small and guest batches are capped below the per-session request allowance; provider retries still consume quota.

Exact/string/numeric/source-link checks are narrow automated checks, not proof of general factual correctness, actual tool execution, or successful rendering. Semantic/source review and UI review remain explicitly `unverified`. `--include-answers` retains up to 12,000 answer characters in the ignored result file for human review; default files contain only an answer hash/length and timings. Only benchmark synthetic data with that option.

Reports separate failures from latency percentiles for completed requests and include per-capability summaries. Small-sample p95 is descriptive, not a production SLO. `source_revision` identifies the source used to run the harness; `deployed_revision` remains unverified until independently established. Do not treat a local commit as production provenance.

To aggregate exported content-free JSON/JSONL traces:

```powershell
node scripts/trace-report.mjs evaluation-results/traces-summary.json evaluation-results/api.jsonl evaluation-results/relay.jsonl evaluation-results/browser.json
```

## Completion gate and next measurement

Local implementation is ready when focused instrumentation/failure tests, the full frontend/backend regression suites, a production build, Python compilation and diff checks pass. The baseline report records actual live samples separately from local validation.

The production attribution gate additionally needs deployment of both API/browser and relay changes, correlated signed-in traces for the representative cases, a cold/warm and busy/failure cohort, and isolated-account memory/workspace review. These remain pending until measured; the existing production sample alone does not identify the cause of each delay. Stage 2 should target the largest measured delay, retain the same evaluation suite, and compare completion/failure rates as well as p50/p95 latency.
