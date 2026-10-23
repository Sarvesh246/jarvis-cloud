# Slash commands

Type `/` at the beginning of a message to browse commands. Arrow keys select a result; Enter or Tab chooses it. Commands with arguments remain in the composer for review. Escape dismisses the menu without changing the draft. Touch users can scroll and tap results. A leading space sends slash-prefixed text literally.

The catalog in `web/src/lib/slash-commands.js` supplies autocomplete and help. App actions run without a model call. AI actions make one ordinary request through the existing chat flow and retain its normal retries and accounting.

| Commands | Behavior |
| --- | --- |
| `/help` | Search the command catalog and examples |
| `/usage [today\|month\|all]` | Read only the authenticated account's recorded cloud usage |
| `/context`, `/status` | Inspect context estimates, connection and response mode |
| `/new`, `/search [query]`, `/rename [title]`, `/pin` | Navigate and organize conversations |
| `/archive`, `/branch` | Hide a chat with Undo or branch from a selected message; archived chats remain searchable and can be restored |
| `/export [md\|json\|txt]`, `/copy [last\|chat]` | Download a transcript or copy content |
| `/stop`, `/retry`, `/continue` | Control the current response |
| `/settings`, `/theme [light\|dark\|system]`, `/presentation [adaptive\|minimal]`, `/profile` | Change appearance and personalization |
| `/attach`, `/files`, `/workspace`, `/detach`, `/library`, `/plan` | Use attachments, Workroom, saved outputs and the current plan |
| `/summarize [instructions]`, `/compact` | Summarize material or shorten future model context while keeping the visible transcript |
| `/research <topic>`, `/explain <topic>`, `/rewrite <instructions>` | Request research, explanations or rewriting |
| `/translate <language and optional text>`, `/compare <items>`, `/check <claim or text>` | Request translation, comparison or verification |
| `/memory`, `/remember <note>`, `/forget [search]` | Review, explicitly save and delete account memory |
| `/remind [in 20m message]`, `/schedule` | Create, inspect and remove account reminders, including fixed daily/weekly repeats and calendar exports |
| `/connect`, `/model`, `/tools` | Manage signed-in devices, inspect automatic routing, and set research/style/role |
| `/shortcuts [name]` | Save account prompt shortcuts or place one in the composer |
| `/temporary` | Start a chat kept only in this running app's memory, without account memory or profile context |

## Usage and context

The relay hashes the verified `web:<subject>` ownership key into usage events. The existing service dashboard remains compatible. The account endpoint derives the same key from the authenticated session and never accepts a client-selected account. Guests cannot read account totals. An additive database migration creates the account column and index lazily; existing unattributed rows remain in service totals but are not assigned to users.

Recorded tokens are input plus output. Cached input is a subset of input. Unknown token reports make totals a lower bound. All-time means all attributed recorded time, not usage predating account tracking. Monthly periods use UTC; the UI also shows the next period's local time and days remaining. Provider quotas are separate.

Context percentage is explicitly an estimate of the current content against Vaelo's base context budget. Provider tokenizers, larger routed windows, images, workspace content and tool prompts can change actual usage. Cumulative consumed tokens are not used as context size.

## Capability boundaries

- `/model` exposes the cloud API's automatic routing; manual provider selection is not available.
- `/connect` manages actual Vaelo sign-in devices. Third-party app connectors are not available.
- Reminders are checked by a signed-in running app every 30 seconds and on focus/online events. Overdue reminders are delivered when reopened. Calendar export includes an alarm for delivery by the user's calendar while Vaelo is closed. These commands do not schedule background AI work. Daily and weekly repeats use fixed intervals, which can shift local time at daylight-saving transitions.
- Temporary transcripts are excluded from account sync, local chat backups, tab backups and persisted reply-recovery entries. In-memory recovery keeps a running temporary reply owned correctly. Cloud providers still process requests, the relay retains normal short-lived run buffers, and account usage still counts tokens.
- `/compact` changes future request context only after an uninterrupted successful summary. It keeps the original messages and can still branch from them.

## Verification

Run `npm test` and `npm run build` from `web/`. The UI regression script uses Playwright with explicit API fixtures and tests real desktop/mobile React flows without changing owner data:

```powershell
npm run dev -- --port 5179
# In another terminal; install Chromium once with npx playwright install chromium
npm run test:slash-ui
```

Override `SLASH_TEST_URL` if the dev server uses another port. `SLASH_SCREENSHOT_DIR` selects an output directory; by default screenshots go to the operating system's temporary directory. The fixture checks completion, keyboard/touch interaction, panel actions, exports, memory, shortcuts, reminders, compaction, stopping, temporary storage isolation, and browser runtime errors. Fixtures are not evidence of production provider availability or physical-device behavior.
