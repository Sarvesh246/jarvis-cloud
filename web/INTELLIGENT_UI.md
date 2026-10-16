# Interactive replies without extra model usage

Vaelo makes structured parts of an existing answer interactive in the browser.
The renderer consumes ordinary Markdown and the existing `metrics` and `timeline`
fences. The existing formatting instructions now choose useful shapes automatically,
using a shorter replacement instruction block. There are no additional UI-planning
requests, retries, model calls, tool calls, or third-party runtime dependencies.
Normal answer tokens still apply; generated answer length can vary. Local
interactions also work offline after a reply loads.

## What people can do

- Filter tables and select rows to compare. Sorting preserves source row identity.
  Reset restores the original ordering and clears filters and selection.
- Suitable numeric series open as charts automatically; comparisons stay as tables.
  Switch either view manually. Charts have complete labels, exact values, readable
  summaries, and a zero baseline. Negative values extend left of zero; positive
  values extend right. Every plotted value remains accessible to screen readers.
- Open **Explore numbers**, choose a column and multiply its values by a factor.
  Results are a labeled local what-if, never a prediction or an inferred formula.
  Mixed currencies, mixed percentage/plain-number columns, blanks, invalid input,
  and non-finite results cannot become numeric scenarios.
- Toggle Markdown tasks directly. Packing lists and clear action steps also open
  as checklists automatically; other simple lists retain **Use as checklist**.
  Completion progress is visible, resettable, and stored on this device. The
  original list remains available. New reply versions have separate state when
  the block changes; different message IDs never share checks.
- Continue using figures, timelines, copy, original-table CSV export, and the
  workspace. Figure labels and titles wrap, values have stronger hierarchy,
  timeline dates remain separate from event details, and table headers visibly
  advertise sorting. Mobile controls keep their text labels.

## Boundaries and efficiency

The trusted component library owns all behavior. Model content is data, never
executable JavaScript, HTML, formulas, or a component import path. No dynamic code
compilation or new network access is needed. Existing source links retain the
existing link handling. Source text is not rewritten by local controls.

The new interactions appear after streaming finishes, so incoming tokens cannot
reset a checkbox or rearrange controls under a pointer. Plain text still streams
normally. Existing figures and timelines can continue to render progressively.
Simple lists only are enhanced; nested or unsupported rich lists retain the
original Markdown. Checklist enhancement is limited to 80 items / 50,000 text
characters, table exploration to 200 rows / 20 columns, and charts to 40 rows.
Automatic selection uses the nearest answer section and conservative checks on
existing data. Dated lists can become timelines; short label/value lists can
become figures. Rich lists with links or code are not rewritten as figures or
timelines, preserving source links and formatting. Original-list controls remain
available. Quantities and budget breakdowns expose number exploration directly;
it stays collapsed on other tables. Simple facts remain prose. Explicit requests
for plain text disable automatic presentation for that reply. The original user
request is passed locally to the renderer, never sent in a second request.
Minimal presentation disables the new controls,
and mapped document editing keeps its existing selection-to-source behavior.

Completion storage holds at most 200 block entries with opaque block identifiers
and completion booleans, not reply text. Blocked storage leaves the controls usable
in memory. Completion state is local presentation state: it is not synced between
devices, sent to the model, or proof that a real-world task was performed. Table
filters, comparison selection, and numeric factors are temporary and do not change
the answer used in later model turns. Copy/CSV export the original table, as the
interface explicitly states.

This architecture improves cost predictability, compatibility with free models,
local response time, and control over readability. It is deliberately bounded:
it does not synthesize arbitrary games, maps, forms, domain calculators, or
simulations from prose. Supporting those reliably requires more predefined
domain components and explicit data contracts; automatic model-authored UI plans
would add output/prompt tokens and cannot honestly promise unchanged usage.

## Verification

Run `npm test` and `npm run build` from `web`. Regression tests cover state
isolation, reloads, damaged/blocked storage, storage bounds, row filtering,
unchanged source data, mixed units, overflow, and the local-only module boundary.
The development-only `/tests/fixtures/adaptive-ui.html` page checks ordinary
requests and unfenced Markdown responses across all automatic selections,
negative examples, plain-text requests, streaming, and minimal presentation.
`/tests/fixtures/intelligent-ui.html` exercises the real
renderer with fixed data, both themes, narrow layout, streaming, and minimal
presentation. It is not included in the production Vite entry point.
