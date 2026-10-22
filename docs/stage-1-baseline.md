# Vaelo baseline — 20 October 2026

Stage 1 instrumentation and the evaluation harness are implemented locally on `feat/stage1-baseline`, based on source revision `e112825`. They have not been deployed. Production observations below measure the existing deployment at `https://vaelochat.vercel.app`; its exact deployed revision was not independently established.

## Production API sample

Three sequential guest-mode batches made 18 requests with synthetic inputs. No production account memory or workspace was modified. Seventeen requests completed, one returned an error, and sixteen passed the narrow automated checks. One completed recall response failed the exact-format assertion; its original answer was not retained, so this is not sufficient evidence of a recall defect. A later retained recall response correctly returned `MAPLE-731` and a correction case returned `Cedar`.

| Case | Requests | Completed | First-answer range | Completion range |
| --- | ---: | ---: | --- | --- |
| Greeting | 2 | 2 | 0.89–3.68 s | 0.93–3.75 s |
| 17 × 23, number only | 2 | 2 | 1.87–25.19 s | 2.21–25.32 s |
| Short rewrite | 2 | 2 | 1.20–4.78 s | 1.27–5.44 s |
| Recall earlier codename | 3 | 3 | 2.82–5.39 s | 2.82–5.39 s |
| Apply a corrected project name | 1 | 1 | 7.46 s | 7.46 s |
| Synthetic table | 3 | 2 | 2.35–2.39 s | 2.56–2.59 s |
| Factor quadratic with LaTeX | 1 | 1 | 1.48 s | 3.17 s |
| Unknown fictional budget | 1 | 1 | 4.02 s | 5.19 s |
| Honest Python-execution claim | 1 | 1 | 1.31 s | 4.42 s |
| Chicago weather with source | 2 | 2 | 3.45–16.22 s | 4.09–16.76 s |

Across the 17 completed requests, first-answer median was **3.12 s** and nearest-rank p95 **25.19 s**; completion median was **3.75 s** and p95 **25.32 s**. With only 17 completed samples, p95 is the maximum and should not be treated as a stable service-level estimate. The table error occurred after 1.65 s and is excluded from completed-request latency statistics, but included in failure counts. Its error code was not retained by the first harness version; later runs retain a bounded code/status. The two subsequent table requests completed successfully.

These measurements start just before the harness's chat POST and include readiness, preparation, routing, retrieval and generation delays encountered by that request. Session establishment is excluded. They do not measure browser warm-up, visible paint, or signed-in memory/Workroom overhead. Guest routing differs from signed-in routing. Cold/warm status, provider identity and competing production workload were not controlled or independently recorded; the 25-second arithmetic result cannot yet be attributed to a particular internal stage.

Raw local results are retained, ignored by Git, at:

- `web/evaluation-results/production-guest.json`
- `web/evaluation-results/production-guest-capabilities.json`
- `web/evaluation-results/production-guest-tools.json`
- `web/evaluation-results/production-combined.json`

The latter two source batches explicitly retained synthetic answers for review. Other files keep answer hashes/lengths only. The combined report deliberately does not retain answer text.

## Capability evidence

| Capability | Evidence obtained | Remaining production validation |
| --- | --- | --- |
| Context | Live synthetic recall/correction cases; existing context/attachment regression coverage. | Long-conversation compression and selected-workspace recall under deployed traces. |
| Routing/reasoning | Repeated simple-task timings and local routing regressions. | Correlated signed-in route/effort traces and provider-side attribution. |
| Tools | Two live weather requests returned source links; local research/data-source/failure tests. | Independent freshness/source checking, signed-in research/tool intervals and busy/timeout cohorts. |
| Memory | Local account memory/regression tests included in the full frontend suite. | Isolated-account persistent recall, corrections, deletion, disabled memory, and cross-account isolation in production. |
| Structured UI | Live signed-in synthetic table/math response; verified table/chart switching, Jan=10, Feb=20, Mar=15, and typeset factors/roots 2 and 3. Local renderer tests passed. | New browser timing records and broad desktop/mobile/device coverage. |
| Verification | Retained live answers acknowledged the fictional budget was unknown and explicitly said Python was calculated without execution; local stream/source/guard tests passed. | Broader semantic evaluation and real execution verification once a sandbox exists. |

The signed-in UI response showed “Thought for 3s,” but no precise end-to-end stopwatch was captured. It is not included in API latency statistics. The adaptive renderer initially displayed a chart even though the prompt asked for a Markdown table; its table toggle showed the exact supplied data. This is a presentation-policy observation for later review, not a claim that explicit format preferences were fully satisfied. Screenshot evidence is local at `web/evaluation-results/production-ui.png`.

## Local validation

- Frontend: **570 tests passed**, using `node --test --test-concurrency=2 tests/*.test.js` from `web/`.
- Backend: **218 tests passed**, using `python -m unittest discover -s tests -q`.
- Production frontend build passed. Vite still reports its large-chunk advisory; this is not evidence that bundle size caused the measured request delays.
- Python compilation and `git diff --check` passed.
- Instrumentation tests cover failed spans, diagnostic sink failures, bounded tool tracking, overlapping tool intervals, request resume/deduplication, timeout cleanup, explicit completion, and separation of automated checks from semantic/rendering review.

## Stage 2 priorities supported by this baseline

1. Deploy observation to a reviewable environment and collect correlated signed-in runs before choosing a latency fix. Keep the same prompts and record deployment revision, route/effort, concurrency and cold/warm cohorts.
2. Investigate the long tail on simple tasks: the identical arithmetic prompt varied by over 23 seconds. The current sample proves variability, not its cause.
3. Retain failure codes and distinguish busy/retry/transport/provider/output-validation outcomes. Do not hide failed requests behind successful-request averages.
4. Complete the isolated-account memory/workspace and source-quality review cohorts. They remain unverified in production.

Stage 1's local implementation and initial baseline are ready. Its full production attribution gate remains open until the new instrumentation is deployed and those cohorts are measured. No claim is made that Vaelo has been sped up by this stage.
