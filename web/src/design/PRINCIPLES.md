# Vaelo design principles

Vaelo's interface is its body and face, not a wrapper around a text box. When
a decision is unclear, check it against these.

**The language is correspondence.** Paper, ink and gilt hairlines. Vaelo
writes to you the way a considered letter is set: one serif voice, rules
instead of boxes, italic for the emotional register.

1. **Presence over decoration.** The mark is a Didone V: one weighted
   stroke, one hairline, fine serifs. It is also Vaelo's face beside each
   reply. Every agent state (idle, listening, waking, thinking, working,
   speaking, settling, concern) maps to one mark state. Nothing else animates
   for its own sake.
2. **Say it where it happens.** Status lives inside the reply, never in a
   header badge. While Vaelo works there is one live italic line ("Thinking",
   "Web search", "Waking up"); afterwards it folds into a receipt ("Thought
   for 8s · 2 steps") that opens to the steps. Stopping keeps what was
   written and offers Continue; retrying keeps earlier versions (1 / 2);
   any of your messages can be edited and resent, and the conversation as
   it stood before the edit is kept as a copy; removing a conversation
   offers Undo instead of a confirmation.
3. **Calm tempo.** 180–600ms, `--ease`, no bounce, no spin, no flash. Ambient
   breathing is 6s. Reduced motion removes movement and keeps meaning.
4. **Honest, reassuring states.** Say what Vaelo is doing in plain words.
   Errors never alarm: earth tone (`--clay`), a kind sentence, one action.
5. **Warm restraint.** Rules and tone over boxes and shadows. Gilt is
   reserved for Vaelo's presence and the one primary action. The user's side
   stays neutral.
6. **One serif voice, legible first.** Newsreader (variable, optical sizing)
   is the whole interface. Light weight at display sizes, regular for
   reading, a slightly heavier weight (`--w-ui`) for small interface text,
   letter-spaced capitals for labels. Italic is for asides only (greetings,
   placeholders, quotes, the live status line); controls and metadata stay
   upright. No sans-serif. Nothing functional under 14px; replies at 19px /
   1.7. Muted text keeps at least 5.5:1 against any surface it sits on, and
   rules must be visible (about 2.5:1), not implied.
   In the rail the gilt V is the first letter of the name ("Vaelo" as one
   word); elsewhere the mark or the word stands alone.
7. **Desktop is deliberate, mobile is its own design.** An index rail, a
   transcript with hanging margin labels (Vaelo / You) and a text column that
   grows with the chat area up to 60rem. Equal margins on both sides keep the
   column, and the composer under it, centred whether the rail or workspace is
   open. Your messages sit on their own slip so the two voices never blur. Drawer (swipe in from the edge), stacked labels, bottom-anchored composer
   and 44px targets on mobile. The page never scrolls sideways: prose wraps,
   and only tables, code and charts scroll horizontally inside their own
   boxes. Installed to a home screen it behaves like an app: no bounce, no
   tap flash, no accidental selection of controls, readable offline.
8. **Every control earns its place.** One icon set (Phosphor, light weight),
   one radius scale, one spacing scale, one elevation scale. No emoji.

## How replies are built

These came out of comparing how ChatGPT, Claude, Grok, Gemini and Meta AI
present their work. Vaelo takes the patterns and keeps its own voice. The
rule over all of them: keep the conversation simple until the output
deserves to become something richer.

9. **A reply is typed blocks, not one blob.** Prose, code, tables, sources
   and states each get the controls that suit them: code shows its language,
   copy, download and a workspace view; tables sort, copy for spreadsheets,
   export CSV and turn into a chart when the numbers would say something.
10. **Inline first, workspace on demand.** The right-hand workspace opens
    only for something worth sustained attention: a preview, long code, a
    reply read as a document, the sources behind an answer. Beside the
    conversation on wide screens, a sheet with a scrim on narrower ones,
    full screen on a phone. Previews run no scripts.
11. **Provenance where it's useful.** Every external link becomes a numbered
    source with its type shown as shape and word (news, social, official,
    research, reference). A mark previews the sentence it supports, and the
    sources panel lists everything. Uncertainty is said beside the sources,
    not as a disclaimer under every reply.
12. **Show the work, not the thinking.** Tool activity is a legible timeline
    ("Searched the web · Lyon rail ridership"), with what the reply drew on.
    Raw reasoning is never streamed.
13. **Every failure has its own way forward.** Offline, busy, too long, signed
    out, interrupted and needs-approval each get their own sentence and
    action. A failure stays local to its reply; toasts are only for things
    that belong to no reply.
14. **Never fight the reader's scroll.** Follow new words only while the
    reader is at the bottom. Scrolling up stops following at once. Blocks
    that grow after their words land keep the anchor.
15. **Modes are one step away.** Attach, write, dictate and send are always
    visible. The current response style is always readable on the composer
    ("Balanced ▴") and opens the tools menu; research shows as a chip you
    can remove.
16. **The model names the shape; the interface draws it.** Beyond Markdown,
    Vaelo may answer with a ```` ```metrics ```` block (a few key figures,
    the first leading) or a ```` ```timeline ```` block (events in order),
    written as plain lines so a half-streamed block still reads. Never HTML
    from the model. Inline stays light; tables open in the workspace to
    filter and sort.
17. **Richness is the reader's choice.** Settings (gear in the rail) offers
    paper (system, Parchment, Lamplight), a larger reading size, Adaptive or
    Minimal replies, reduced motion independent of the system, and a
    notification when a reply finishes while you're away. Kept per device.
18. **Durable work lives outside the transcript.** The rail's Library
    gathers long replies, longer code and tables from every conversation,
    each reopening in the workspace with a way back to its reply. A
    document can be edited directly or revised a passage at a time (select
    it, say how it should change, preview, accept); every change is a
    version, the original is never lost, and the conversation itself stays
    as it was said.
19. **Status changes what's already there.** While Vaelo answers, a light
    runs along the composer's top edge; scrolled away, the "jump" pill
    carries Vaelo's face and current action. Live status waits ~300ms
    before showing, so quick answers don't flash a state they never needed.

## Tokens

All values live in `tokens.css`. Components read variables; they do not
introduce colors, radii or durations of their own.

## Voice

Short, warm, practical. "Good evening, Sarah." "What would you like to take
care of?" Never marketing copy.
