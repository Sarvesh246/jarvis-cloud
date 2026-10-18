# Installed FreeLLMAPI usage

The Vaelo relay records one content-free event per accepted attempt at
`/api/session?resource=usage`, reusing a function within Vercel's current plan.
Postgres retains it across cloud restarts. Input and output tokens use upstream
usage reports; cached tokens are a subset of input and are not added twice.
Retries use the same event id. Attempts without usage remain visible as gaps.
Hermes reports the tool rounds in its turn totals; direct routes explicitly ask
for streamed usage. Local router activity is counted separately, once, from its
hourly SQLite aggregates.

The writer authenticates with `USAGE_INGEST_KEY`, falling back to the existing
Render `API_SERVER_KEY` / web `JARVIS_API_KEY` pair. The read credential is separate:
`USAGE_READ_KEY`, or HMAC-SHA256 of `usage-dashboard-read-v1` with the writer key.
It only reads aggregate counters. It cannot submit events or access chats.

`sync.py` polls every 15 seconds while the local router is running. A Windows
logon task launches it with a private config containing `url`, `readKey`,
`database`, and `output`. Only counters and timestamps reach `client-dist`.
The dashboard polls that local file every five seconds and labels stale data.
The `--once` option verifies a snapshot without installing a task.

Coverage begins when recording is deployed. Earlier unrecorded usage cannot be
reconstructed from shared provider credentials. Provider quotas and capacity
estimates are separate from these observed totals. An interrupted stream may
have no terminal usage report; such attempts are flagged, never guessed.
The Render outbox retries delivery during temporary ledger failures, but Render's
ephemeral disk cannot retain an undelivered event across a container replacement.
