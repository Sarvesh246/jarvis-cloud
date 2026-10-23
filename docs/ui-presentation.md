# Everyday interface components

Vaelo uses native React components and the existing paper, ink, typography,
spacing and motion tokens. The [21st.dev catalog](https://21st.dev/) informed
the interaction patterns below; these implementations do not install a second
design system or execute component code supplied by a reply.

## Placement and behavior

| Pattern | Surface and behavior |
| --- | --- |
| Source citation rail | Desktop workspace and phone source sheet; numbered links, active citation, expandable answer passage and copy-link recovery. |
| AI artifact | Inline HTML/SVG preview and workspace; preview/code/split, phone/desktop framing, copy and download. Preview scripts and external resources remain blocked. |
| Weather widget | Existing forecast contract; hourly strip, selected days, weekly ranges and provider attribution. |
| Image compare | Inline before/after slider with pointer, touch, keyboard range control and links to originals. |
| AI diff | Code comparison and document revision previews; originals and accepted versions stay accessible. |
| Comparison table | Inline tables; select rows, compare a subset, inspect differences, sort, search and export. |
| Timeline | Automatic chronological layouts and explicit timeline blocks; dates do not imply task completion. |
| Data visualizations | Automatic line/bar/stacked charts, sparklines and optional proportional tiles/heatmap; negative values retain signed chart behavior. |
| Photo gallery | Automatic multi-image answers; grid, carousel, lightbox, zoom and downloads. Uses actual supplied media. |
| Audio player | HTTPS audio links and audio blocks; native controls, original link and playback error recovery. Does not generate audio. |
| Question tool | Explicit closing question plus 2–6 choices, or a question block; selection adds text to the current composer's draft. Sending remains the reader's choice. |
| Conversation tree | Reply version history with previews and direct version selection, beside existing branch controls. Only recorded versions are shown. |
| Attachments | Composer file cards, reading state, size, errors and removal; existing bounded document/image readers. |
| Smart paste | Long clipboard text becomes a named attachment card with full-text preview, edit/save/cancel/remove. It follows the normal attachment and request limits. |
| File card collection | Shared format badge across composer, Library and Workroom documents. |
| Prompt composer | Existing style, research, role, attachment, dictation and send/stop controls; responsive shared spacing. |
| Input suggestions | Local actions based on ready attachments: summarize, find next steps and compare multiple files. |
| Command menu | Existing grouped action/chat/saved-work search, arrow navigation and Enter/Escape; selected result stays valid as results change. |
| Project card | Library preview with a notched cover and existing Workroom project cards; open, return to reply, versions and deletion actions. |
| Integration grid | Existing interactive workflow cards and measured connectors. Proposed workflows never claim account connection. |
| Reply actions | Existing copy, retry, branch, save, revision and phone action sheet; shared spacing with version history. |
| Usage meter | Reply receipt, using reported input/output token counts; no invented provider balance, allowance or reset schedule. |
| Context meter | Reply receipt, using actual retained/dropped earlier-message counts and file count. |
| Animated drawer | Shared phone sheets; content-driven height transitions, bounded height, drag dismissal, Escape, focus containment and restoration. |
| Segmented control | Library kind and desktop Settings choices; roving focus, arrow keys, Home/End and scrollable overflow. |
| Skeleton card | Workroom's initial load, settings account loads and rich-view preparation. No fake percentage. |
| First-run welcome | Existing first-run/onboarding flow, engraved welcome card and functional capability starters. Returning users can collapse capabilities. |
| Error empty state | Library filters, memory load failures and Workroom reload recovery. |
| Tool call | Reply receipt timeline; expandable plain-language details, actual status and measured duration. |
| Bento grid | Welcome capabilities and existing rich overview cards; responsive columns and reusable spacing. |
| Animated diagram card | Welcome source-to-answer and goal-to-steps illustrations; buttons open the corresponding prompt. |
| Chart illustration card | Welcome data capability; decorative illustration is separate from charts of supplied values. |
| Grain/light card | Onboarding's engraved V card, pointer-following light and a keyboard/touch-accessible information reverse. |
| Dot pattern | Subtle Workroom background; panels retain opaque reading surfaces. |
| Animated weather icons | Existing dot-matrix conditions; restrained condition cues during inspection, static with reduced motion. |
| Voice orb | Active dictation panel and desktop recording control; microphone analyser drives scale when available, otherwise recording state remains visible. |

## Automatic response presentation

The shared model guidance describes supported shapes in the existing request.
Settled-response recovery then recognizes unambiguous content locally, across
providers, even when the model replies in ordinary Markdown:

- Numeric series, dated milestones, comparisons, checklists and structured summaries.
- Three to six unique, short, nonnumeric bold-labelled details.
- Multiple real Markdown images, without requiring a gallery keyword.
- A closing question followed by two to six explicit choices.
- Real HTTPS audio file links, outside fenced code examples.

Specialized charts, comparisons, timelines and supplied-data recovery take
precedence over general summary cards. Code, worked mathematics, mapped
document editing, explicit plain-text requests, minimal presentation and live
streaming retain their existing protections. Original data remains available.

No classifier, second model generation or extra presentation API request is
introduced. Cards never invent media, source excerpts, integration status,
usage allowances or conversation branches.

## Verification

`web/tests/everyday-ui.test.js` exercises schema rejection, automatic daily
presentation, plain/code protections and the real reply renderer. Existing
output and prompt-coverage tests protect the earlier rich response shapes.

`web/tests/fixtures/everyday-ui.html` exercises real composer, reply, chart,
source rail and sheet components with synthetic data and no model/account
requests. Browser checks cover desktop, tablet and phone widths, clipboard
editing, choice selection, keyboard controls, chart views, comparison rows,
version history, source passages, artifact preview, image comparison, sheet
resizing, focus/Escape and horizontal overflow.

Physical-device dictation, audio availability and provider output still depend
on the device, permission and actual media/provider response.
