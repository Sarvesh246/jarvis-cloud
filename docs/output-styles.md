# Output styles

The chat renderer uses the supplied 26-style design reference. Output selection is local for Markdown tables, dated lists, figures, action lists, and file trees. Rich JSON schemas are supplied to the existing model request for relevant natural prompts and substantive requests; there is no classifier request or second rendering request. Explicit plain text and source requests retain their requested format.

Run `npm run dev -- --port 5178` from `web`, then open `/tests/fixtures/redesign.html`. This development-only page renders each sample through the actual `Message` component. The phone control opens the same component in a 390px document so media queries run at the phone breakpoint. Use the style selector, theme control, Minimal and Streaming switches to inspect each case.

| # | Style | Renderer and main behavior | Example prompt |
|---|---|---|---|
| 1 | Markdown | Newsreader headings, ruled section labels, upright quotes, gilt code and diamond bullets | Review these lease clauses |
| 2 | Tables | Visible filter and sort, row selection, selection tray, comparable best-value marks and score bars | Compare these laptops |
| 3 | Bars | Signed zero baseline, labelled scale and focus/hover reading | What changed across regions? |
| 4 | Lines | Persistent point readout, keyboard selection, quiet grid and low/high/change strip | How did revenue change over time? |
| 5 | Stacked bars | Vertical columns, totals, toggled series and share readout | Show the monthly revenue breakdown |
| 6 | Figures | Display-size lead figure, ruled supporting grid and directional deltas | Summarize the key business numbers |
| 7 | Timeline | Proportional dated phases, selection, relative dates and supplied states | Plan the website relaunch |
| 8 | Checklist | Large row targets, progress ring, local persistence, reset and undo | What should I do before the event? |
| 9 | Steps | Guided/all tabs, segmented navigation, numbered steps, Back/Next/Finish | Walk me through setting up the project |
| 10 | Overview | Dark lead card, supplied totals and calculated shares | Summarize the trip budget |
| 11 | Widgets | Peeking stack, arrows, position and clickable dots | Explain the assumptions behind the plan |
| 12 | Graph | Layered directed nodes, relationship filters and visible connection list | How do the systems depend on each other? |
| 13 | Files | Folder chevrons, icons, depth guides, counts, expand/collapse and path copy | Show the project structure |
| 14 | Image | Rounded generated-image frame, dimensions and image controls; external reference card | Show the generated image |
| 15 | Image board | Dense image tiles and shared lightbox with previous/next | Give me a studio inspiration board |
| 16 | Carousel | Fixed-ratio stage, overlay arrows, position and thumbnails | Let me browse these room photos |
| 17 | Lens | Local circular loupe, 2×/3×/4× control and keyboard inspection | Inspect the architectural details |
| 18 | Image comparison | On-image split handle, keyboard range, labels and presets | Compare these two room photos |
| 19 | Code | Lamplight palette, line numbers, gutter folding, fold all, wrap, copy and save | Write a safe total function |
| 20 | HTML/SVG | Inline Preview/Code/Split, phone/desktop width and reload in an isolated sandbox | Build a small welcome card |
| 21 | Code diff | Unified/split views, paired word changes, counts and local review notes | What changed between these versions? |
| 22 | Receipt | Scalloped slip, dotted leaders, total and local split stepper | Split these trip expenses between two people |
| 23 | QR | Framed code, domain and full URL, copy, SVG save and open | Open these docs on my phone |
| 24 | 3D | Explicit load, progress, retry, rotate and reset | Let me inspect this supplied GLB model |
| 25 | Integrations | Declared source/destination flow, selectable details and unconnected notice | How could these systems work together? |
| 26 | What-if | Visible factor, slider, presets, supplied/scaled bars and difference | What if the trip costs increased by 25%? |

## Verification

- All 26 samples rendered through the actual chat component in browser checks, including a phone document, without raw-payload or renderer fallbacks.
- The complete web suite passed 435 tests. After the final what-if layout revision, 13 focused rendering and calculation checks passed; after the compact table revision, all 8 focused rendering checks passed. The final production build and `git diff --check` passed.
- Browser interactions checked row selection/comparison; guided/all-step navigation; checklist reset/undo; code folding; receipt splitting; number presets; inline HTML rendering; and loading a public GLB with rotate/reset controls.
- The reference's static sample figures and dates are examples, not application data. The renderer does not infer that a past milestone is complete. Supplied `[done]`, `[current]` and `[upcoming]` markers are supported in timeline event text; an unmarked past date is labelled Past. Undated labels do not receive an invented year.
- Integration directions use optional `direction: "source" | "destination"` fields. Older cards without directions show neutral systems instead of an invented flow. All are illustrations and do not connect services.
- Three ordinary prompts were sent through the real chat server to the configured cloud model. The bill prompt returned a validated receipt with Hotel $480, Food $160, Travel $75, total $715 and two people ($357.50 each). The service-dependency prompt returned a validated graph. The walkthrough returned ordinary numbered Markdown which the chat renderer automatically presented as guided steps. None of these prompts requested a component or JSON.
- A browser image-download action saved a 70,436-byte PNG. The what-if +25% action changed the supplied $715 to $893.75 with a +$178.75 difference. The final phone audit measured all 26 samples at 374–389px document widths with no horizontal page overflow or renderer fallback.
- These checks cover local application changes and real provider responses, not a production deployment. Rich-format selection is model guidance within the existing request; arbitrary model responses can still vary. Tests do not establish pixel-for-pixel equivalence across every possible content and device combination.
