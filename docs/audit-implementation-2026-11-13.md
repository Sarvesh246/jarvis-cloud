# Vaelo audit implementation — November 13, 2026

Source: the November 13 audit supplied for revision `0d8c131`. This document distinguishes shipped code from configuration and proposals that still need evidence. The full audit is not certified complete by this change.

## Implemented

| Audit items | Result |
|---|---|
| 1.2, 1.9 | A successful POST starts and streams the reply on one connection. Old 202/resume clients still work. The happy path skips the health probe; failed starts use the bounded wake/retry path. |
| 1.3 | Ordinary direct calls have a four-second connection/header deadline, then use the existing fallback. Code and vision retain their separate longer deadlines. Parallel speculative agent execution is not enabled because a losing agent can already have performed tool actions. |
| 1.5 | Bounded provider keep-alive pool. Only fully consumed responses can return a connection; partial, failed and stopped streams close it. Leases detach on release so an old run cannot stop a reused connection. |
| 1.6 | Memory and recall reads overlap; recall still requires current opt-in and forgotten-note filtering. Notes are not cached across requests, preserving current privacy preferences. |
| 1.8 | External relay wake workflow plus optional shared event journal. Recovered runs replay accepted event numbers; interrupted runs keep their partial answer and end explicitly. Recovery never repeats tool actions. |
| 1.14 | On-demand 72-case provider comparison harness with deterministic checks, a separately configured model judge, answer/model/latency records and checkpointed output. Listing cases makes no provider calls. |
| 1.15, 1.16 | Fallback titles strip injected location/request notes; location instructions prohibit printing coordinates. |
| 2.1 | Rail props exclude in-progress assistant text, stable handlers feed a memoized rail, and saved-work extraction caches each unchanged chat. |
| 2.2 | Independent completed Markdown blocks are memoized separately from the open tail. References, nested lists, quotations and display math stay together to preserve document semantics. Highlighting and fold lookup are memoized. Whole-answer cleanup and conservative parsing paths still operate on the complete text. |
| 2.3 | Lazy settings, Workroom, workspace, saved work, command palette, tools, slash panels and reply renderer; native plugins load on demand. The build emits a manifest and first-paint bundle report, enforced at 400 KB of JavaScript. |
| 2.4 | Signed-in backups use IndexedDB records per chat, write changed records, serialize transactions, retain divergent offline edits, migrate legacy data only after a successful write, and notify other tabs. |
| 2.5, 2.8, 2.11 | Debounced guest snapshots with page-exit flush, stable keyboard listener and shared in-flight session request. |
| 2.6 | Build-derived shell version and asset list, critical dependency precache, current-asset pruning, and real offline fallback responses. API data is never cached by the worker. |
| 2.9, 2.10, 2.12, 2.13 | Settled-message content visibility, Newsreader font tokens/preload, code-font loading with reply rendering, bounded image cache, thread/message busy state and completion announcement. |
| 3.2, 3.3 | Locale-aware separators and accounting signs; ambiguous k/m/b suffixes require a money/count column or currency. Chart and calculator parsing use the shared parser. |
| 3.4, 3.6–3.8 | Duplicate renderer removed; spotlight extracted; formatted replies offer Show as written; shared sandboxed preview construction and safe relative-link handling. |
| 4.1–4.7 | Full-width rail titles with hover actions, service/offline distinction, touch hit areas, paused off-screen/hidden marks, still idle mark, readable sign-in entrance, platform-specific Find shortcut and focus-only empty composer hint. |
| 4.8, 4.10–4.21 | Install guidance follows a completed reply in a dismissible sheet. Newsreader, unique animation names, rail reflow removed from transitions, drawer/sheet flicks, transform-only sheet transitions, fewer blur layers, keyboard/assistive confirmation, relative phone text, visible sign-in controls and desktop composition, dock-relative toasts and touch image controls. |
| 4.24, 4.25 | Explicit still Mark under reduced motion, balanced headings, forced-colors outlines and clearer cancelled-state wording. Existing component reduced-motion rules remain. |
| 5.1, 5.2 | Storage/session failures remain service failures. Guest minting has an atomic persistent per-network limit; rotating guest tokens retains the relay's pseudonymous network subject. Raw IP addresses are not stored or sent upstream. |
| 5.3, 5.4, 5.5 | Immutable chat parts are read in one database query. Feed connections last 25 seconds, with slower fallback polling. KV initialization and reads/writes/deletes have bounded database fetches. |
| 5.7 | Versioned storage migration command and managed-schema mode; compatibility initialization remains until the deployment switches to a migrated runtime role. |
| 5.8–5.13 | Feed transport split from chat prompts, run-bound single-consumption memory grants, owner-checked approvals, separate usage read/ingest credentials, immutable hashed assets, COOP/CORP headers and refreshed environment examples. |
| 6.1, 6.2, 6.4 | Tray/menu, global summon, remembered window state, opt-in autostart, activation-only vaelo links, hidden-until-painted window, startup/daily update notices and HTTPS/mailto native opener scope. |
| 6.3, 7.3, 7.5 | Tagged Apple releases require signing configuration; smaller desktop PR matrix, narrowed paths, check concurrency/read permissions, Store release permission separation and Dependabot. |
| 7.1, 7.2, 7.4, 7.6, 7.7 | ESLint/hooks checks, unique-keyframe check, bundle budget, dependency audit, Ruff/coverage in CI, browser checks with owned previews, native Clippy, cached Docker verification environment, healthcheck, Vaelo README/diagram and package metadata. |
| 3.1 | Streaming-to-settled changes cross-fade once; short local card changes also interpolate height. Reduced motion skips the transition, and large replies avoid continuous document layout animation. |

## Required deployment configuration

- Set independent `USAGE_INGEST_KEY` and `USAGE_READ_KEY`. The relay also requires `USAGE_INGEST_KEY`; neither service accepts the relay authentication key for usage access.
- To enable restart recovery, set the same independent `RUN_STORE_KEY` on web and relay, and set relay `VAELO_RUN_STORE_URL` to the web `/api/feed` URL. Run events contain private reply content and are account-scoped; temporary and guest replies stay out of shared storage. Set a separate `CRON_SECRET` on web to authorize the daily expiry job. Expired events become unreadable after an hour and are deleted by the next daily cleanup. The journal batches events and caps pending frame bytes at 16 MB during storage outages; a hard crash can lose the most recent unacknowledged batch. It preserves answers, not a resumable provider execution. Live durable storage has not been exercised here.
- Run `npm run db:migrate` in `web` against the intended database using `MIGRATION_DATABASE_URL`, then set `VAELO_SCHEMA_MANAGED=1`. A separate runtime role can then have DDL removed by the database owner. No production migration, privilege change, database deletion or hosting-plan purchase was performed.
- Native features require a new desktop build. Compilation does not verify operating-system tray behavior, signing, autostart or deep-link installation on each platform.

## Remaining audit work and decisions

These items are still open; they must not be inferred complete from passing unit tests.

- **1.1:** Verify Neon placement and deployed function regions before moving web execution. The audit's region diagnosis was suspected, not established.
- **1.4, 1.11–1.13:** Collect route/latency evidence and run the real-model comparison before changing fast-first routing, reducing the prompt or choosing model rankings. The new harness has not called candidate models or a judge. Existing prompt/session behavior is preserved.
- **1.7:** Shared router cooldowns/counters still require work in the separate router deployment.
- **1.10:** Model titles still use the existing prefix protocol. Moving metadata to the tail needs compatible filtering and provider-quality checks.
- **1.17, 1.18, 2.7, 3.5:** The proposed route-strategy rewrite, async relay, complete App hook/store extraction and renderer-module consolidation are separate architectural work. This change extracts bounded helpers and rendering chunks without certifying those rewrites done.
- **2.2, 2.9:** Full cleanup remains per frame, complex Markdown remains document-wide, and lists beyond 200 messages are not virtualized.
- **3.1:** The minimum completion transition is implemented. Choosing all rich shapes at the beginning of generation remains a protocol/rendering follow-up.
- **4.12, 4.22–4.25:** Rail sizing now changes once, rather than reflowing each animation frame. Wholesale cascade-layer/token enforcement, all small-type corrections and conversation View Transitions remain open. Physical phone motion and larger-text behavior need device validation.
- **5.3, 5.6:** The JSON chat manifest remains; a real per-chat manifest table, tombstone pruning and scheduled retention/orphan cleanup remain open. Take and verify the requested backup before the first destructive cleanup.
- **3.6:** Locale/currency inference for automatically recovered cost/explorer presentations remains open. The original-source toggle is implemented.
- **3.9, 3.10:** Reply actions/version-switch consolidation, clean-text copy and additional exports remain open. Folding, diff highlighting and stacked-chart data alternatives are implemented; the code-language registry is not.
- **5.8:** `/api/session` still has static store dependencies. Feed helpers are separated.
- **5.12, 6.4:** Broad HTTPS image/media connections remain necessary for the existing user-supplied remote-media/3D features. Tightening this requires a media-fetch design that preserves those features.
- **6.3:** Windows trusted signing needs an enrolled identity/certificate; Apple signing needs configured release credentials.
- **7.1, 7.2, 7.5:** No TypeScript migration, complete browser-screen suite/nightly matrix or full action-SHA pinning was added. ESLint dependency warnings remain visible. Desktop build-job release permissions still warrant further separation.
- **7.4:** The pinned image/bootstrap's runtime-user contract is preserved; this change does not claim a non-root container deployment.
- Original-checkout cleanup, merged-branch deletion and a paid relay are operational decisions; the separate original checkout and its local work were preserved.

## Verification

- Web suite: 1,067 tests passed. Focused storage/streaming follow-up: 37 passed; eight recovery/pool checks also passed after bounding the outbox.
- Python suite: 373 tests completed, 13 Linux-confinement cases skipped on Windows.
- Native: Cargo check, Clippy with warnings denied, and three native tests passed on Windows.
- Browser: 24 message-editing cases, 20 table checks, 12 desktop offline cases, 12 iPhone-layout offline cases, and the keyboard confirmation check passed with mocked APIs.
- Production web build, bundle budget, ESLint (zero errors; existing dependency warnings remain), unique-keyframe check and Ruff passed.
- Runtime dependency audit: zero known vulnerabilities. First-paint JavaScript: 280,939 bytes against the 400,000-byte limit.
- Local capability evaluation and six router tests passed. The model-comparison harness lists 72 cases; no candidate-model or judge calls were made.

These local checks do not establish provider quality, real production database behavior, release signing or physical-device behavior. The production container checks are configured in CI and were not executed locally.
