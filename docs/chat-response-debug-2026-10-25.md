# Chat and response debugging — October 25, 2026

The audit reproduced and fixed content corruption in response presentation,
JSON handling, code examples and mathematics, plus gaps in output constraints,
freshness routing and stalled-stream detection. Production also exhibited
intermittent upstream stalls that remain unverified after these local changes.

## Scope and isolation

- Base: `ab7b316bd9ab01c388f7ca5c5131850e2db697b8`, freshly fetched from `origin/main`.
- Branch: `fix/chat-deep-debug-20261025`, in an isolated checkout. The primary
  checkout's ongoing work was preserved.
- Both production web and backend reported this base revision, protocol 3.
  The evaluation reports recorded stable deployment revisions during each run.
- Reviewed request shaping, history/context selection, output contracts,
  streaming/recovery, memory directives, formatting/cleanup and the actual
  React renderer. No model or provider was replaced.
- Live requests used synthetic conversations and disposable signed-in test
  identities. No owner conversations or saved personal memories were inspected
  or modified. Test sessions were revoked by the existing benchmark runner.
- These changes have **not** been pushed or deployed. Production results below
  describe the existing deployment, not the modified code.

## Reproduced issues and fixes

| Issue | Reproduction and impact | Change and verification |
|---|---|---|
| Raw output changed after generation | `{"message":"Ready!Next?Yes"}` became `{"message":"Ready! Next? Yes"}`. Markdown/math parsing could also reinterpret literal data. Reload normalization repeated the mutation. | Respect raw JSON/CSV/TSV/code/plain-text requests in live flushes, saved replies, versions and rendering. Preserve JSON prefixes even without an explicit raw request. Display literal output without inferred widgets or math, use monospace for structured data, and wrap long identifiers within narrow screens. Real browser streaming and reload checks preserve exact values. |
| JSON example strings treated as memory directives | A valid JSON string containing `[[remember: Prefers tea]]` was silently emptied by the relay before contract validation. It could also be interpreted as a personal memory instruction. | Validate JSON without stripping its string values. Do not emit memory-note events for constrained output or save notes from literal replies in the browser. A relay integration test preserves the exact JSON and verifies no memory event is emitted. |
| Cleanup deleted literal code | Cleanup only protected a subset of backtick syntax, so tilde fences and some longer examples lost literal provider tags. | Share the fence/span scanner with cleanup; support marker lengths, tilde fences, unfinished examples and quoted/list containers. Regression tests verify literal tags survive while actual metadata outside code is removed. |
| Code examples consumed the following answer as math | A quoted tilde code block containing an unmatched `\(` was scanned as TeX. Its matching delimiter in later prose could pull multiple paragraphs into one formula; during streaming the answer could be held back as unfinished math. | Identify container fences before math scanning. Preserve code and typeset only actual prose equations. Verify nested/quoted examples, unfinished delimiters and the following answer through unit tests and the real renderer. |
| Natural sentence requirements missed | Production research returned an introduction, two explanatory sentences and a footnote for a request to explain `json.loads` in two sentences. This wording was not recognized by the output contract. | Add shared recognition of “explain/describe/summarize … in N sentences/words/lines.” Python validation and browser-side presentation guidance now use the same policy. Tests reject an extra sentence and ignore requirements inside attachments. This validates length, not factual correctness. |
| Private correction sent to public freshness lookup | “Our fictional project is called Amber” followed by “it is now called Cedar … its current name” triggered a public lookup. The trace recorded about three seconds in freshness retrieval before a longer upstream stall. | Keep these private project-field follow-ups in conversation context. Explicit external lookups and public current-fact questions still request evidence. Tests cover both decisions and the complete chat-input boundary. This removes an unnecessary lookup; it does not establish that the separate provider stall is fixed. |
| Empty deltas counted as progress | Repeated `data: {"choices":[{"delta":{}}]}` frames reset the upstream progress timer without producing an answer. | Only content, reasoning, tool activity and terminal events renew the progress clock. A relay test confirms empty deltas cannot keep a stalled answer alive; active approval waits remain exempt. The existing timeout/recovery budget is unchanged. |
| Evaluation falsely rejected valid uncertainty | A correct answer saying “I can’t determine” failed an ASCII-only keyword check. | Normalize curly apostrophes for semantic keyword checks. Keep exact-output and JSON equality checks exact. |

Previously saved replies whose string values were already mutated cannot be
reconstructed automatically. The fixes prevent further mutation.

## Production observations

32 live probes were attempted: 9 guest probes, 9 existing signed-in probes,
12 additional conversation probes and 2 refined probes. **28 completed and 4
hit the harness deadline.** These are selected diagnostic samples, not an
availability estimate or a measure of general intelligence.

Completed answers demonstrated arithmetic, decimal precision, correction and
recall in several cases, negation, missing-information handling, rejection of a
false arithmetic premise, inclusive numerical boundaries, supplied-source
extraction, translation and exact JSON/CSV generation. The Python-verification
probe completed with the actual verifier tool recorded; numerical output alone
was not treated as evidence of execution.

Material unresolved observations:

- A project-name correction and a code-execution honesty request each exceeded
  90 seconds without a delivered answer. A separate multi-field correction and
  a repeated constrained rewrite each exceeded 60 seconds. Their retained runs
  were explicitly stopped by benchmark cleanup.
- Traces place the delay in the Hermes upstream stream, with no tool activity
  explaining the wait. One correction received upstream answer content around
  45.8 seconds, but the client still had no completed, validated answer at the
  60-second deadline. Hermes traces did not identify the upstream model.
- A small guest JSON response took about 32.3 seconds. The successful explicit
  Python-verification request took about 46.5 seconds.
- The 120-second no-progress guard is distinct from these 60/90-second harness
  deadlines. The new empty-delta regression fix is not evidence that the live
  stalls share that exact cause.
- Two initial probe failures were test-specification issues: an extraction
  prompt did not specify numeric budget representation, and a rewrite check
  omitted the valid wording “won't be able.” The source extraction was correct;
  a refined numeric-type request subsequently passed. The repeated rewrite
  timed out, so the suite is not reported as fully passing.

No deployment or model-quality improvement is claimed from local tests.
After deployment, repeat the conversation suite with a longer observation
window and inspect upstream provider timing before changing routing or budgets.

## Validation and repeatable coverage

- Existing baseline: 1,040 web tests passed; 363 Python tests ran successfully
  with 13 skipped.
- Updated suite: 1,047 web tests passed; 366 Python tests ran successfully with
  13 skipped. Skipped runtime/provider checks were not counted as verified.
- Production web build passed. Vite still reports its pre-existing large-chunk
  warning; bundle splitting was outside this audit.
- 16 actual browser scenarios passed: Chromium and WebKit, widths 390 and 1440,
  JSON, CSV, quoted code and mathematical/table output. JSON and CSV scenarios
  submit a new request through `followReply`, receive separate timed stream
  chunks and verify the exact answer again after reload. Checks include page
  overflow, browser exceptions, math fallback and code contents. The checks
  were repeated against the production build with shipped fonts verified as
  loaded and asset HTTP errors rejected. Screenshots were inspected.

Reusable entry points, from `web/`:

```sh
node scripts/baseline.mjs --suite chat --cases all --include-answers
# Use scripts/signed-baseline.mjs with isolated test-account configuration
# for signed-in and attachment cases. Guest mode skips signed-in-only cases.

node scripts/verify-chat-responses.mjs
# Build and start the production preview on 127.0.0.1:5188 first,
# or set CHAT_TEST_URL to an equivalent local build.
```

The new chat suite covers multi-turn corrections, changed exclusions, hostile
quoted source instructions, hard limits, pending versus settled payments,
unknown facts, false premises, exact JSON strings, CSV, constrained rewriting,
translation negation and contradictory supplied evidence. Each saved answer
still requires semantic review; deterministic checks do not establish general
reasoning quality.

Machine-local evidence (ignored by Git):

- `web/evaluation-results/chat-live-before.json`
- `web/evaluation-results/chat-signed-before.json`
- `web/evaluation-results/chat-adversarial-production.json`
- `web/evaluation-results/chat-refined-probes.json`
- Web/Python/build logs in the audit checkout.
- Browser screenshots and results under the system temporary directory's
  `vaelo-chat-responses/` folder.

The nightly automation was not changed. These scripts can supply explicit
chat-focused coverage in a subsequent scheduler update.
