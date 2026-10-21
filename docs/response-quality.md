# Response quality and diagnostics

The cloud gateway normalizes supplied text using the same 360,000-character
request budget as the web service. The pinned Hermes image previously capped
normalization at 65,536 characters, dropping the middle and ending of larger
attachments. The Docker build applies a guarded adjustment to that constant;
an unexpected upstream contract stops the build. Browser file limits, request
byte limits, history limits and model token budgets still apply. This preserves
input at the gateway boundary; it does not guarantee model recall after context
compression. Local Windows Hermes is not modified.

Fresh browser tabs create independent conversation drafts. Reloading restores
the conversation remembered by that tab. Existing empty conversations remain
available but are never implicitly adopted by a different fresh tab.

Explicit raw-format, answer-only and numeric length requirements suppress
automatic rich-view guidance and inferred answer shapes. Teaching defaults defer
to these requirements. The model is instructed to check requested fields and
calculations before publishing one consistent result. These guidance rules do
not constitute deterministic validation of arbitrary model output.

## Python verification

Signed-in agent replies have a `python_verify` tool for a self-contained Python
implementation and assertion tests. The disposable Linux child interpreter loads
selected standard-library modules before installing an irreversible seccomp
syscall allowlist. Filesystem access, sockets, process creation, execution of
other programs and privileged syscalls are denied. The child inherits no account
environment or application file descriptors. Its limits are two CPU seconds,
five wall-clock seconds, 192 MB of address space and 32 KB of combined output.
There is no shared terminal, package installation or third-party dependency
support. Unsupported systems fail closed. Guests do not receive this tool.

Only the submitted implementation and tests are verified. Passing tests do not
prove general correctness. Expected values must be independently checked: the
intervals `[-5,-3], [-2,1], [0,4]` merge to `[-5,-3], [-2,4]`, with a gap between
the two outputs. Code verification should also compare mutable inputs against a
copy taken before execution.

Run actual confinement regressions on Linux:

```sh
python3 -m unittest discover -s tests -p test_verification.py -v
```

CI installs libseccomp and executes these tests, including filesystem, network,
process, CPU, output and incorrect-expected-value cases.

## Latency diagnostics

Production API and relay logs emit content-free JSON records with
`kind: "vaelo.trace"`, schema version 1, and the full reply run ID. Correlate that
ID across layers to distinguish account authorization, selected work, memory,
backend readiness, run creation, first model thought, first answer and total
duration. Follow completion in the web layer means that an event-stream follow
finished; the relay and browser records describe the answer outcome.

Open the browser with `?diagnostics=1` to enable matching console records for
first answer chunk, first render commit, completion and restart/error outcomes.
Browser diagnostics make no telemetry requests and retain no prompt, answer,
attachment, account, credential or URL fields. All durations use one monotonic
clock per process; do not subtract wall clocks across machines. A first render
commit measures the React update request, not a guaranteed physical display paint.

The disposable `/tests/fixtures/benchmark-sync.html?diagnostics=1` development
fixture runs the actual application with a shared synthetic cache and stubbed
responses. Open independent tabs, send distinct prompts, confirm distinct request
identities, then reload one tab and confirm its next send retains its identity.
This fixture checks client behavior; it does not measure signed-in cloud capacity.
