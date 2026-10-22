# Vaelo capability completion pass — 21 October 2026

This pass starts from `05278f9`, after inspecting current main and preserving the unrelated work in the primary checkout. It reconciles the earlier local Stage 1 work with the tracing and Python verifier that had since shipped on main. Scope is cloud Vaelo and its browser client; local Windows Hermes and FreeLLMAPI are unchanged.

## Implementation by stage

| Stage | Result |
| --- | --- |
| 2 — response path | Chat POST begins immediately; readiness is owned by the API rather than a second awaited browser warm-up loop. Busy retries have finite attempt/time budgets. Direct connections have an 18-second deadline. Two transport failures open a 30-second process-local circuit with one recovery probe. |
| 3 — context | Recent turns retain their original messages. When older turns must be dropped, deterministic ranked excerpts preserve relevant older facts and constraints within the same character/count budget. Historical quotes retain role/turn labels; later corrections take precedence. No generated summary or embedding call is added. |
| 4 — reasoning/routing | Bounded self-contained explanations, summaries and writing can use the direct route. Research, risky tasks, attachments, selected work, contextual references and requested depth retain the agent path. Output budgets vary by tier; requested reasoning effort is preserved. |
| 5 — tools | Existing parallel search/page extraction and model-driven weather/image tools are retained. Python verification remains syscall-confined with CPU, address-space, wall-time and output limits. Only one verifier process runs at once. A clean process exit without completion of both source and tests is no longer accepted as verified. |
| 6 — memory | Saved notes are ranked by relevance. Optional indexed full-text search retrieves bounded source excerpts across the same account's saved chats. Current manifest versions gate every result. Deleted/edited notes suppress matching older excerpts; turning memory off stops retrieval. Desktop and phone controls support opt-in, preparation, note edits and deletion. |
| 7 — structured rendering | Explicit “Markdown table” requests stay tables by default; chart controls remain available. Existing validated schemas, local interactive controls, rich mathematics, streaming and readable fallbacks are preserved. Desktop and 390px phone fixture checks cover actual App/Settings/rendering components. |
| 8 — evaluation/release | Shared traces, repeatable guest/signed-in benchmarks, local integration tests, live database privacy/version checks, Linux confinement checks and an evaluation CLI are available. CI runs the evaluation suite without a model judge. Release and production measurements are recorded below when verified. |

A measured direct-route defect was the mismatch between a valid 14,593-character web fast prompt (including saved preferences) and the relay's former 8,000-character cap. The relay silently discarded that fast prompt and used Hermes. Both sides now share a 24,000-character limit in the context policy, with regression coverage. This is distinct from provider availability or hosting cold starts.

## Memory and source boundaries

Past-chat retrieval is **off until enabled** in Settings → Personalization on desktop or Settings → Memory on a phone. “Prepare past conversations” backfills older saved conversations in bounded batches; subsequent successful saves index new revisions. Preparation reports oversized conversations it skips. Index writes are best effort after the authoritative save; preparing history again repairs missed index work without changing original chats.

Retrieval uses PostgreSQL full-text search and deterministic excerpt ranking, not embedding-based semantic search. Each indexed conversation contains at most 100,000 characters and 160 excerpts, with at most 6,000 characters read from a single turn. Very large legacy conversations over eight storage parts are reported as skipped by the bounded backfill. Supplied attachments, running/failed drafts and hidden memory markers are excluded from the index. Results include source titles, dates and role labels. Historical assistant claims are unverified data, not instructions or established personal facts.

Each query joins the account's current manifest and current memory preferences. Other accounts, deleted conversations and old revisions cannot be returned. No history result cache can resurrect a deleted revision. Note-edit/delete suppression is conservative keyword matching; it can omit an otherwise useful excerpt. At the bounded suppression-record limit, past-chat recall pauses rather than silently forgetting deletion protections. Current conversation text remains available in that conversation; deleting a note does not rewrite the transcript.

Optional memory reads and history searches have separate one-second and 1.2-second deadlines with cancellation signals. Missing/unavailable context does not create facts or block the answer indefinitely. No extra model call is used for ranking, indexing, summaries, rendering or automated evaluation. Explicit verification, research and retries still use their normal tool/model resources.

## Verification scope

`python_verify` executes self-contained Python and supplied assertion tests with selected preloaded standard-library modules. It does not install packages, access accounts/files/networks, run arbitrary shell commands, or prove arbitrary code correct. An output completion marker distinguishes normal test completion from accidental early process exit; this is not a cryptographic attestation against adversarial self-modifying test code. Expected values still need independent review. Confinement fails closed, and a busy verifier returns an explicit result instead of spawning more workers.

## Pre-change evidence

Guest API benchmark: eight requests, eight completed and passed the narrow automated checks. First-answer median was **3.945 seconds**, nearest-rank p95 **47.150 seconds**; completion median **3.962 seconds**, p95 **47.230 seconds**. The long outlier was a greeting. Signed-in isolated-account sample: three completed requests; first-answer median **2.434 seconds**, p95 **18.929 seconds**. Samples are small, provider/workload conditions were not controlled, and guest and signed-in routes are different cohorts.

Before/after raw results and screenshots are local, ignored files under `web/evaluation-results/`. Default benchmark results omit response text; synthetic answer capture is explicitly opt-in. Disposable benchmark sessions are revoked after each run. Live database tests use separate synthetic account ids, soft-delete their synthetic conversations, remove notes and disable memory after checking privacy and revision handling. No owner memory or real chats are modified by those tests.

## Reproduce

From `web/`:

```powershell
npm test
npm run evaluate
npm run build
npm run baseline -- --cases greeting,arithmetic,rewrite,context-recall --repeat 2 --out evaluation-results/guest.json
```

With the application database configured locally, `npm run evaluate -- --database` verifies actual account isolation, replacement/deletion handling and memory controls against isolated synthetic records. With production application signing configuration and that database available, `scripts/signed-baseline.mjs` creates/revokes an isolated test-account session and accepts the regular baseline options. Credentials stay in environment variables and are never printed or written to result files.

Run Linux confinement regressions with `python3 -m unittest discover -s tests -p test_verification.py -v`. Windows-only validation skips actual seccomp execution and must not be reported as a Linux sandbox pass. The capability fixture is `/tests/fixtures/capabilities.html?diagnostics=1` on the Vite dev server; it uses actual UI components with synthetic API responses and makes no real model or verification claims.

## Release evidence

Local regression, build, visual and database checks are required before the main push. GitHub CI, Vercel readiness, the Render revision, post-release model/tool behavior and comparative latency are separate evidence. Run-specific results are retained under the ignored `web/evaluation-results/` directory and in the release report; this source guide is not a live deployment-status page. A successful frontend deployment alone does not prove that the backend revision changed, that every answer is correct, or that a free provider always meets the latency target.
