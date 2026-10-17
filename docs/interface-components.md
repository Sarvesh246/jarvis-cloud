# Interactive interface

Vaelo implements the selected interaction patterns in its existing React and CSS system. It does not load six entire component libraries. The additional runtime packages are `qrcode`, `diff` and the on-demand `@google/model-viewer` viewer; their upstream licenses remain in the installed packages.

## Where to find the controls

| Feature | Location |
| --- | --- |
| Global commands and search | **Find** in the conversation header, or **Ctrl/⌘ Shift P**. Searches actions, conversation titles/content and saved outputs. Ctrl/⌘ K still starts a conversation. |
| Pinned ordering | Drag the **chat title** directly; a lifted preview and moving rows show its destination. On touch, hold briefly before dragging. **Reorder** still offers keyboard Move up/down controls. Escape cancels. Order is per account on this device. |
| File dropzones | Drop onto a conversation or a named file slot in Workroom. Existing file validation and upload handling remain in place. |
| Recording/attachment island | Appears above the composer while recording, transcribing or reading an attachment. Expand it for details. |
| Activity history | Actual research/tool events remain in the reply activity area; completed events remain inspectable. |
| Notices | Multiple notifications stack above the composer. Each keeps its own timeout, pause and undo action. |
| Workroom cards | Open Workroom → **Tasks**. Choose a task or **Create a reusable task**. |
| Workroom stages | **Files & notes**, **Run a check**, and **Result** make the next action explicit. Essential file slots and context appear first; additional files and task settings are optional disclosures. **Chat about this** starts the conversation; **Save task** keeps it for reuse. |
| Field validation | Required Workroom check fields show an inline message after leaving an empty field. Existing parsed-money/date feedback remains. |
| Destructive actions | Existing explicit delete/keep and unsaved-change confirmations remain in their original flows. |
| Tabs and panels | Conversation/library and workspace tabs support Left/Right/Home/End keys. Existing mobile sheets and dialogs retain focus containment. |
| Split/resizable panels | Expand a code block, table or document. Drag the workspace divider, use arrow keys, or Home/End for the width limits. |
| Source previews | Hover or keyboard-focus a citation marker. Source cards retain metadata, positioning and source-panel access, with brief transitions. |
| Reading position | Open a long reply as a document; the bar at the top follows the document scroll. |
| Revision comparison | Edit a document and save a second version; choose **Compare versions**. Large versions retain the normal document view. |
| QR links | **Settings → QR link and interface guide**, or find that action in global commands. QR generation happens locally. |
| Browser/device mockup and feature tour | **Interface guide → Where to find things → A quick tour**, with Desktop/Phone previews. |
| Connection badge | In the interface guide, indicates the browser's actual online/offline state; does not assert backend health. |
| Greeting motion | The welcome heading has a restrained variable-weight hover treatment. |
| Reduced motion | **Settings → Motion → Reduced**, or the operating-system preference. |

## Answer-specific components

Use **Settings → Replies → Adaptive**. Completed visual blocks appear as soon as their fence closes, even while the rest of a response streams. Recognizable incomplete visual blocks show a quiet preparation state. Minimal mode, explicitly plain/code replies, malformed or excessive structured data retain original content. Controls do not change the stored answer or automatically send another request.

Replies and expanded documents use the self-hosted **Source Serif 4** reading face; **Source Sans 3** keeps dense controls clear. **Newsreader** remains on chat titles, the welcome screen and the brand. Motion is brief, interruptible and respects reduced-motion preferences.

| Pattern | Behavior |
| --- | --- |
| Budget/range slider | **Explore numbers → Adjust factor**, beside an exact numeric input and Reset. |
| Stacked bars | In eligible multi-series charts, choose **Stacked breakdown**. Requires nonnegative, complete, same-unit series; percentages and incompatible data are excluded. The control explains that stacking is appropriate only for additive series. |
| Step player | **Step through** on supported ordered lists, or a `steps` block. Includes previous/next, restart and all-steps view. |
| Checklist | Existing persistent local checks, progress and reset are retained, with completion feedback. |
| Bento / spotlight cards | An `overview` block; the lead card spans the grid. Figures remain supplied values rather than invented metrics. |
| Widget stack | A `widgets` block. Swipe/scroll naturally or use previous/next arrows. Bento overviews stay as grids without a view selector. |
| Relationship graph | `graph` blocks show supplied edges, directional arrows and connection filters. **View connections** reveals the textual edge list. Large diagrams scroll internally. |
| File tree | `files` blocks group paths into expandable folders. |
| Masonry / carousel / lens | `gallery` blocks offer an image board and manual carousel. **Inspect image** reveals magnification. |
| Image comparison | `image-compare` blocks expose a keyboard-adjustable split and original-image links. |
| Code comparison | `code-compare` blocks expose changes or a side-by-side view. Diff work and payload size are bounded. |
| Inline review comments | Add a note to a diff line. Notes remain in this tab's session storage, keyed to the exact compared content; no comment is sent to a provider. |
| Receipt | `receipt` blocks list supplied amounts and calculate their total locally with the supplied currency. They do not assert payment. |
| QR | `qr` blocks encode a supplied HTTPS address locally. They do not grant access to a private conversation. |
| 3D model | `model` blocks load a supplied HTTPS `.glb` URL only after **Load 3D model** is chosen. Viewer code is lazy-loaded. |
| Integration cards | `integrations` blocks describe supplied system roles. They do not create connections or assert account authorization. |
| Rolling figures | Existing Vaelo rolling numbers remain in use. |

The implementation draws on the patterns catalogued by [Bencho](https://bencho.dev/), [React Bits](https://reactbits.dev/c/components), [Animate UI](https://animate-ui.com/), [Magic UI](https://magicui.design/), [Spark UI](https://spark-ui-olive.vercel.app/docs/components) and [Eldora UI](https://www.eldoraui.site/docs/components). These are original adaptations to Vaelo, not claims that their individual vendor components were installed. Dribbble is visual reference material, not an installed library. Decorative cursor trails, always-running particles, pets and immersive 3D navigation were not part of the recommended functional replacements.

## Prompts to try

1. **Bento and widgets:** “Show a bento overview for my four-day trip: hotel $480, food $160, travel $75. Include the total and a widget stack for the details. Use only these numbers.”
2. **Charts and what-if:** “Make a Markdown table of monthly spending: January rent $1200 and food $300; February rent $1200 and food $280; March rent $1200 and food $340. These are additive categories. Let me explore the amounts locally.” Choose Chart, Stacked breakdown, or Explore numbers.
3. **Steps:** “Give me a numbered five-step guide to preparing a document for submission. Keep each step self-contained.” Choose Step through.
4. **Graph and file tree:** “Show a relationship graph: Browser sends requests to API; API reads Database; API reads Cache. Then show a file tree for src/App.jsx, src/api/client.js, src/design/tokens.css and package.json. Do not add other nodes or paths.”
5. **Code diff:** “Show a code comparison. Before: `const total = values.reduce((a, b) => a + b);` After: `const total = values.reduce((a, b) => a + b, 0);` Keep both versions exact.” Add a local review note afterward.
6. **Receipt:** “Show an itemized receipt summary in USD for hotel 480, food 160 and travel 75. Sum only these supplied amounts. This is a planning summary, not a payment receipt.”
7. **Images:** “Create an image gallery using these two public HTTPS image URLs: [paste URLs]. Use those exact URLs and include descriptive labels.” Try Image board, Carousel and Magnification. Ask for an image comparison using the same two URLs to test the split.
8. **QR:** “Show a QR code linking to https://react.dev/.”
9. **3D:** “Show a 3D model preview for https://modelviewer.dev/shared-assets/models/Astronaut.glb, labelled Astronaut example.” Choose Load 3D model.

The model may choose prose or Markdown when a requested visual lacks suitable data. Rich-format guidance is attached only to relevant requests; ordinary requests retain the existing formatting prompt budget. No separate formatting/classification model request is introduced.

## Structured format

Rich blocks use a fenced `vaelo-ui` JSON object with `type` and optional `title`:

```json
{"type":"overview","title":"Weekend","items":[{"label":"Hotel","value":"$480"},{"label":"Food","value":"$160"}]}
```

The renderer also recognizes validated objects in `json`, `application/json`, unlabeled fences, or standalone JSON paragraphs. Common component names such as `bento`, `file-tree` and `qr-code` normalize to their known types. Explicit requests for raw JSON/source preserve code, as do executable-language fences. The **••• → View original data** option keeps the exact payload available without crowding the visual.

The parser accepts only known types and validates their fields. Invalid JSON, unsupported types, excessive payloads, unsafe URLs, missing graph endpoints and invalid numeric amounts fall back to original text. Renderers do not accept HTML or executable callbacks. External images/models may require their host to allow access and, for models, CORS.

Tables open with the data visible. **Filter and compare** reveals filtering and row selection; sorting stays available on headings. **Explore numbers** remains a separate optional tool.

## Local verification fixtures

Run `npm run dev` from `web`, then open:

- `/tests/fixtures/rich-ui.html` — every structured type, themes, narrow layout, streaming/Minimal fallback, commands, Workroom, settings and stacked notices.
- `/tests/fixtures/component-app.html` — the actual app with disposable tab-local guest conversations and stubbed API responses. No live model requests.
- `/tests/fixtures/intelligent-ui.html` — existing table, checklist, metrics and timeline regression cases.
- `/tests/fixtures/responsive-ui.html` — actual app or component controls in a 390px/1100px viewport, including Workroom dialogs.

These development fixtures are not included in the production build.
