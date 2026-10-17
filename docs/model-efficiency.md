# Model efficiency audit

Audited 16 October 2026. Scope: Vaelo's cloud request shaping, relay, recovery,
research plugin, Workroom checks, and cloud router configuration. Changes are
local until released. No production credentials or live model generations were
needed for the regression checks.

## Changes

| Finding | Change | Expected saving or quality benefit |
| --- | --- | --- |
| A socket failure after an explicit completion marker could regenerate an already finished answer. | Honor the terminal marker unless the stream reports a model failure or token truncation. | Avoid an unnecessary continuation request and its repeated input. Streams without a completion marker still recover. |
| Reposting the start of a failed, already generated run could start its entire recovery sequence again. | Retain that run's error and numbered events under its original ID. Explicit user retries use new IDs; pre-generation busy starts remain retryable. | The regression with three empty generations stays at three requests after a duplicate start, rather than starting three more. Retention remains bounded to the relay's existing lifetime and memory limits. |
| A partial lightweight answer always escalated to the full agent for continuation. | Continue eligible direct answers through the same configured route and short prompt. Empty continuations and request failures escalate to Hermes. | Avoid full agent instructions and tool schemas on successful lightweight continuations. This does not remove the continuation's necessary model call. A failed direct continuation can add a failed request before fallback. |
| The account name interrupted the lightweight prompt's shared instructions. | Put the unchanged lightweight instructions before account data. Preserve the full agent prompt byte-for-byte. | Supporting providers can reuse a longer static prefix across lightweight chats. Actual cache hits and token pricing depend on the selected provider/model; input length is not reduced. |
| `finish_reason=length` followed by `[DONE]` was accepted as a complete answer. | Continue token-truncated replies, surface an error if recovery is exhausted, and clear the UI's truncation flag only after successful completion. | Prevent silently incomplete output. This can increase necessary calls; it is a reliability correction, not a claimed saving. Empty continuations also cannot falsely complete the previous partial answer. |
| Relay timing logs did not expose request or reported-token counts. | Add content-free upstream request counts, usage-report counts, and reported prompt/completion/cache-read token totals. Repeated cumulative usage chunks count once per attempt. | Make avoidable recovery and cache behavior measurable without another model call. |

Model selection, reasoning policy, output token limits, context limits, toolsets,
research coverage, and provider fallback configuration are preserved. Full and
lightweight prompts retain their instructions and account data. The full prompt
keeps its existing order to preserve Hermes's session hash and associated state.
No local Windows Hermes/router settings were changed.

## Existing efficiencies confirmed in Vaelo source

- Request classification, response-shape selection, and UI presentation use code.
- Workroom calculations and acceptance checks use code rather than an LLM judge.
- Devices follow numbered relay events; a network reconnect normally resumes the
  original generation rather than requesting another answer.
- Cloud configuration disables background review and model-generated title
  upgrades. It excludes the skills toolset, avoiding a routine skill-loading
  round trip.
- Compression is deferred until the configured context threshold. Earlier
  compression would itself spend a model call and introduce lossy summaries.
- Research fuses duplicate source URLs and bounds page text, response size, and
  extraction count. Extraction uses HTTP and text processing, without an extra
  summarizing LLM call in the plugin. Both configured search indexes remain in
  use to preserve source coverage.
- The cloud agent profile orders eligible free, tool-capable, sufficiently large
  context models by intelligence rank. The existing conservative fast-path
  classifier handles small self-contained requests separately.

## Measurement limits and next decisions

`upstream_requests` counts relay HTTP attempts, including rejected starts. A
Hermes request may contain several internal model/tool turns and provider retries;
the counter is not a complete provider-call ledger. `usage_reports=0` means usage
was unavailable, not that the reply consumed no tokens. Reported totals reflect
upstream stream accounting, not independently verified billing, and cache-read
tokens are part of prompt tokens, not an additional charge to sum into them.
Direct providers may omit stream usage, and hidden reasoning, auxiliary calls,
and nested router retries need provider/Hermes accounting to reconcile.

After deployment, compare recovery rate, actual provider request counts, prompt
tokens, cache hits, time to first answer, completion rate, and answer correctness
over comparable workloads. Include simple conversation, long follow-ups, coding,
research, files, images, and Workroom tasks. Regression tests verify control flow
and preserved payloads; they do not prove equivalent real-model answer quality
or a production-wide percentage saving.

Further reductions require evidence before changing behavior:

- The full agent prompt contains 7,667 characters of shared guidance after its
  conversation identifier. Moving this earlier could improve caching, but also
  changes Hermes session identity. Introduce a versioned prompt/session migration
  before applying that optimization to existing conversations.
- Measure retries inside both Hermes and the router before reducing retry
  budgets; both layers may be contributing to successful fallback.
- Inspect the pinned cloud Hermes runtime before changing research caching.
  The local upstream checkout contains search/extract caching, but it is not
  proof that the pinned deployed image has the same implementation. Duplicating
  cache layers or extending freshness windows could hide current information.
- Large document/history prompts remain a potential cost driver. Aggressive
  trimming, retrieval-only context, smaller models, and lower reasoning effort
  need representative quality evaluations first; none were introduced here.
- Recovery after tool use currently carries tool labels and the original
  conversation, not all source results in relay-owned state. Recovering a
  persisted Hermes transcript could avoid repeated research, but requires a
  verified, owner-scoped contract with the pinned runtime before implementation.

## Validation

The web suite passes 369 tests, all 86 backend tests pass, and the production build succeeds. Backend tests
cover duplicate starts, completed streams with late transport failures, genuine
interrupted streams, token-limited replies, lightweight continuations, empty
continuation escalation, fallback, approvals, cancellation, usage aggregation,
and research limits. Python compilation and `git diff --check` pass.
No live deployment or production savings measurement is implied.
