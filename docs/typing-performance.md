# Composer performance

The composer keeps its draft in an App-owned synchronous store. Only the
composer subscribes to individual characters; the welcome mark subscribes to
the presence of words. Sending, quoting, commands and conversation switches
read or update that same store immediately. Unsent drafts remain in memory
and retain the existing conversation-switch and sign-out behavior.

Stable event callbacks and memoized controls keep the composer out of reply
token updates. Attachment serialization runs when files change, rather than
on every keystroke. Its cached length includes exactly the same fences and
separators as the submitted message. Native textarea sizing avoids the
reset/measure/write cycle where supported; the fallback batches measurement
and handles width changes and font loading. Neither path changes the field's
mobile/desktop height limits.

Slash-menu resets now avoid redundant state writes during normal typing.
Stop clicks prevent their default action so a button that becomes Send during
cancellation cannot submit the pending draft.

Prompts, model routing, provider settings, context policy, request assembly,
response cleanup and answer rendering are unchanged.

## Production browser measurements

Compared with `24d3f8a`, using production builds on the same machine and
Chromium with 4x CPU throttling. Each test types 85 characters into a
conversation with 60 messages and 40 other conversations; attachment cases
also include a roughly 140,000-character Markdown file with nested fences
and Unicode. These are synthetic browser measurements, not physical phone
measurements or provider response-time measurements.

| Case | Input to next frame, p95 before | After | Shell renders before / after | Long tasks before / after |
| --- | ---: | ---: | ---: | ---: |
| Phone, history | 67.1 ms | 15.7 ms | 84 / 0 | 51 / 0 |
| Phone, history and file | 75.1 ms | 20.5 ms | 84 / 0 | 80 / 0 |
| Desktop, history | 52.7 ms | 17.6 ms | 84 / 0 | 18 / 1 |
| Desktop, history and file | 61.4 ms | 22.5 ms | 84 / 0 | 62 / 0 |

Phone JavaScript time fell from 2.90 to 0.16 seconds without the file, and
from 3.36 to 0.23 seconds with it. Layout count fell from 254 to 85 per
85-character test. The baseline raised update-depth errors and lost a
character during rapid input; the optimized build preserved every character.
Timing and long-task counts vary with machine load.

## Regression checks

`npm run test:typing-ui` runs against `TYPING_TEST_URL` (default
`http://127.0.0.1:5183`). All API and speech responses are isolated fixtures;
it does not change production account data.

- `TYPING_ENGINE=webkit TYPING_FUNCTIONAL_ONLY=1` exercises the Safari engine.
- `TYPING_FALLBACK=1` forces the older-engine textarea sizing path.
- `TYPING_PWA=1` enables the real service worker and reloads its controlled
  production shell with standalone display mode emulated.
- `TYPING_BASELINE=1` records the original behavior without enforcing the new
  performance and character-preservation assertions.
- `TYPING_OUTPUT` selects where JSON measurements and screenshots are saved.

The browser checks cover growth/shrink and width changes, caret retention,
IME Enter, character limits, exact submitted attachment contents, draft
restoration, late dictation, slash-menu dismissal, complete streamed output,
typing during streaming, Stop preserving the next draft, first-character
updates and the welcome mark. Unit regressions also cover synchronous
functional draft updates, independent stores, attachment ownership and exact
length accounting. Real iPhone keyboard/PWA behavior still needs device
verification.

Release checks: 846 frontend tests, six provider-patch tests, 363 backend
tests (13 platform/environment skips), the local capability evaluation,
Python compilation, the production build, 43 slash-command browser flows,
and Chromium/WebKit desktop and phone composer flows. Both sizing paths and
the Chromium service-worker-controlled PWA shell were exercised. No live
provider quality benchmark or physical-device run was performed.
