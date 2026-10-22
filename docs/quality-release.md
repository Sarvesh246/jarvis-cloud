# Vaelo answer quality and efficiency

This cloud release extends the context, memory, tracing and transport work described in [capabilities-release.md](capabilities-release.md). The acceptance rule is that a faster response cannot qualify as an improvement if task success, completeness, grounding or explicit constraints regress. This document distinguishes code shipped here from existing safeguards and model-dependent experiments.

## Coverage

| Area | Implemented behavior and boundary |
| --- | --- |
| 1. Measurement | A seeded 200-case synthetic suite across 13 task families, eight generated vision cases, strict deterministic checks, conventional median and p95/p99, degraded/failure accounting, deployment revision checks, capability cohorts and an independent-review comparison gate. Parameterized cases are not 200 independent task types. |
| 2. Model routing | Existing direct/agent separation, capability-compatible router selection, deadlines and circuit breaking remain. Traces now retain up to eight syntactically bounded upstream-reported model identifiers. These identifiers are not independently verified provider identity. No unmeasured model is promoted based on presumed quality. |
| 3. Complete context | Historical retrieval searches whole bounded source turns, including middle/end occurrences. A correction displaced while reserving digest space remains eligible for retrieval. Original recent turns and configured context limits remain authoritative. Exact provider tokenizer budgeting is not available from every routed provider. |
| 4. Retrieval | Deterministic ranked passages preserve role/turn or original document character locations. Workroom selection uses the current question to select relevant passages. This adds no embedding or reranking model request; semantic embeddings remain an experiment. |
| 5. Attachments | Local PDF text, DOCX paragraphs/tables, XLSX sheets/cells/formulas/cached values, and PPTX slide text. ZIP/XML expansion, input, text and time budgets are enforced. Existing CSV/Unicode handling remains. No macros, external data or formulas execute during parsing. |
| 6. Calculation | Decimal arithmetic and timezone-aware date-difference tools expose precision and assumptions. Strict numeric answer-only requests can complete without a provider call when the exact result fits. Approximate and ambiguous prose retain normal model handling. |
| 7. Output requirements | The relay checks explicit numeric word/line/sentence/character limits and conservative raw-JSON requests, including simple named required fields and duplicate keys. Invalid candidates stay out of the visible answer and repair context. One bounded repair is allowed; repeated failure returns an error. This is not a universal schema, language, semantic-consistency or truth validator. |
| 8. Code | Python verification remains confined. JavaScript verification adds a synchronous QuickJS runtime behind the same process admission, seccomp and OS limits. Tests exercise correct and deliberately incorrect expected results, mutation, unavailable host APIs, CPU and memory limits. Neither runtime proves arbitrary programs correct. |
| 9. Tool behavior | Arithmetic/date tools join the cloud tool registry. Existing read-only research parallelism, repeated-tool guards and bounded selective recovery remain. Tool events distinguish execution from a model saying it executed. |
| 10. Grounding | Existing primary-source/freshness policies, unresolved-citation recovery and honest degraded forecast evidence remain. Source-boundary guidance is strengthened. Presence of a citation is not semantic support for every associated claim. Independent review is still required. |
| 11. Vision | Relevant follow-ups resend available original image data from the preceding image turn. Missing original pixels are explicitly unavailable. Guidance distinguishes shapes/chart marks, observed values and absent data. Generated cases cover counting, chart labels, OCR references and missing values. No new OCR engine or screen-capture permission is introduced. |
| 12. Memory | Existing account-scoped indexed recall, correction/deletion suppression, opt-in controls, bounded reads and two-account privacy tests remain. Better history ranking also applies to long-turn excerpts. This release does not automatically save more user facts. |
| 13. Workroom | Current selected documents retain exact stored content; oversized sources use question-relevant labeled passages. Existing revision/save/conflict handling remains. No model-generated summary substitutes for the original source. |
| 14. Synchronization | Existing per-tab conversation identity, durable run ids, replay deduplication, reconnect, stop and conflict tests remain in the full suite. Higher production capacity is not claimed from local transport tests. |
| 15. Backend speed | Exact calculation avoids provider latency. Existing 18-second direct connection deadlines, bounded retries and unhealthy-route suppression remain. Shared traces now expose reported model ids for diagnosis. Hosting size, provider quotas and region placement are unchanged; no heavy production load is generated implicitly. |
| 16. Efficiency | Passage selection, file parsing, arithmetic and output validation are deterministic. Parsers load lazily; Office parsing runs in a disposable worker. Existing freshness/account-scoped caches remain. Hermes session headers are not enabled blindly because they can change edit/branch history semantics. |
| 17. Streaming | Unconstrained replies retain streaming. Explicit constrained answers wait until their contract passes, so an invalid early guess is not shown for apparent speed. Existing cancellation, reconnect and rendering batching remain. |
| 18. Presentation | Existing math, tables, validated rich widgets, mobile/desktop layouts and copy behavior remain. Strict raw JSON suppresses a trailing weather widget. Document readiness and extraction failures are visible in the composer. |
| 19. Language/time/voice | Seeded multilingual cases and DST ambiguity tests expand coverage. Existing current-date/timezone context and voice controls remain. Speech recognition/pronunciation quality still depends on the browser/voice provider; no new speech model is deployed. |
| 20. Advanced experiments | Offline export accepts only complete hash-matched synthetic answers with passing independent review. Matched comparison tooling rejects incomplete reviews and quality regressions. No training job, paid model, additional hosting or automatic multi-model critic is started. Those choices require representative evidence and available resources. |

## Document boundaries

Files are read locally before the extracted content travels through the ordinary chat request. The new document input limit is 8 MB. Office archives are limited to 2,048 entries, 4 MB per selected XML part and 16 MB expanded selected parts. Extraction must fit the existing message budget. Workers terminate after success, failure or a 15-second deadline. PDF text extraction allows up to 200 pages and stops at its character budget.

PDF extraction preserves page labels but does not promise multi-column reading order, tables, OCR, handwriting or chart understanding. Scanned PDFs with no extractable text ask for clear page images. Office extraction preserves text and cell/source labels, not full visual layout. Spreadsheet formulas are labeled as formulas and cached values; they are not recalculated or assumed fresh. Legacy binary DOC/XLS/PPT files remain unsupported.

The PDF implementation uses [PDF.js](https://mozilla.github.io/pdf.js/examples/); Office archives use [fflate](https://github.com/101arrowz/fflate) and fast-xml-parser. JavaScript verification uses the pinned [quickjs-ng Python binding](https://pypi.org/project/quickjs-ng/0.17.0.1/), rather than a host Node process.

## Verification boundaries

`javascript_verify` accepts source and synchronous tests. It provides no Node, DOM, filesystem, network, timer, package installation or Python bridge. QuickJS has a 64 MB engine limit, 512 KB stack and 1.5-second execution interrupt, inside the existing 192 MB address-space, two CPU-second, five wall-second and bounded-output process limits. One Python or JavaScript verification process is admitted at a time. Missing confinement/runtime fails closed. TypeScript compilation, asynchronous integration tests and project dependency installation are outside this tool.

Generated tests and expected values need independent review. A successful test exit is evidence for those tests only, not a universal proof or adversarial code attestation.

## Reproduce

From the repository root:

```powershell
python -m unittest discover -s tests -v
python -m compileall -q cloud
node --test deploy/freellmapi/bootstrap.test.mjs
git diff --check
```

Actual confinement tests require Linux, libseccomp and `pip install -r cloud/requirements-verification.txt`. Windows skips cannot be reported as Linux sandbox validation.

From `web`:

```powershell
npm ci
npm test
npm run evaluate
npm run build
npm run baseline -- --suite comprehensive --cases all --mode signed-in --seed 731 --out evaluation-results/current.json
npm run benchmark:compare -- evaluation-results/before-reviewed.json evaluation-results/after-reviewed.json evaluation-results/comparison.json
npm run benchmark:export -- evaluation-results/current-reviewed.json evaluation-results/reviewed.jsonl
```

Signed-in benchmarks require an isolated test-account cookie supplied through the environment, or `scripts/signed-baseline.mjs` with existing application signing/database configuration. Guest batches remain limited to 18 requests. Running all 200 requests is an explicit benchmark operation, not part of `npm test` or CI. A different seed supplies held-out variants. Use `--suite visual --cases all` for the eight generated image cases. Use `--include-answers` only for synthetic output being independently reviewed; ordinary reports store answer hashes and counts.

The comparison gate requires matching cases/environment/mode, verified deployment revisions, at least 30 samples per cohort, and independent hash-matched judgments for correctness, completeness, grounding and constraints. It rejects a lower automated or semantic pass rate. Its latency figures are descriptive and do not establish causation or statistical significance. The exporter does not submit a training job and rejects unsupported image suites.

Local browser fixtures are `/tests/fixtures/documents.html` for actual parser workers and `/tests/fixtures/capabilities.html?diagnostics=1` for actual App components with synthetic API responses. Neither fixture is evidence that a production model used extracted content correctly.

## Release evidence

Before this release, four production guest requests completed and passed their narrow automated checks on frontend revision `7c65a5dcf12d7f380f1f21cd524c80d2afc311d8`. First-answer median was 3,193.5 ms and completion median 3,229 ms. The four-request maximum was 6,831 ms. This sample is too small to approve a speed optimization or estimate a population p95/p99.

The completed local checks include the full web/backend suites, Linux code confinement, production build, evaluation CLI, compileall, router bootstrap tests and browser PDF/DOCX/XLSX/PPTX extraction. Run-specific raw reports remain in ignored `web/evaluation-results/`. CI, frontend readiness, backend revision and post-release provider behavior must be reported separately. No overall percentage gain is asserted from parser tests, synthetic fixtures or this small production sample.
