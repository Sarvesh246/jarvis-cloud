Vaelo 0.1.7 for Windows, macOS, and Linux.

These notes cover the changes since 0.1.2, including the updates shipped in
0.1.3 through 0.1.6.

## Replies look better

Every reply type was reviewed on desktop and phone, in light and dark.

- The hourly temperature curve now scrolls with its hours and lines up with each one.
- Bar charts keep each label beside its bar on phones, and checklist headers no
  longer clip at the card edge.
- Numeric table headers line up with their figures, and short timeline phases
  keep their names.
- A generated image and its caption read as one card, and an image that cannot
  load leaves a calm placeholder instead of a broken glyph.
- Code, table, metric and timeline toolbars stay on fewer rows on phones, and
  sideways scrollers use a quieter track.

## Weather

Everyday weather questions now open a detailed forecast in the conversation.
Ask about today, tomorrow, a weekday, a date, or the coming week. Follow-ups
such as “what about Friday?” keep the location from the previous weather question.

- Current temperature, feels-like temperature, conditions, and daily highs and lows.
- An hourly forecast with temperatures, conditions, rain chances, and a temperature curve.
- Wind, humidity, UV index, sunrise, and sunset when the provider supplies them.
- Selectable days for weekly forecasts, explicit units, local times, and source timestamps.

The forecast comes directly from Open-Meteo without a model call. Share an
approximate location in Settings or name a city in the question. Current conditions
are model estimates; past dates, longer-range requests, and questions needing
research use the normal answer path. Plain-text and table requests keep their format.

## Desktop and saved work

- A redesigned desktop layout with a collapsible conversation rail, a live desk,
  and a side panel for saved work.
- Full-page Settings with navigation for account details, devices, memory, and history.
  Device revocation and account data use the server rather than a local-only display.
- Desktop Projects in Workroom, clearer library controls, and improved navigation.
- Resizable tables and comparison highlighting for differences between options.
- New application icons based on Vaelo's V mark.
- The phone keeps its own layout, including its earlier navigation and settings behavior.

## Replies and research

- Cards, charts, timelines, widgets, file browsers, and other structured layouts
  appear automatically when they suit the answer. They also work when a model
  returns ordinary prose or data instead of the requested visual format.
- Better layouts in both color modes, with readable fallbacks and access to the
  original response. Explicit text, code, JSON, and table requests take precedence.
- Proper mathematical typesetting and worked explanations, with less waiting for
  routine math questions and cleaner output while an equation is still arriving.
- Location-aware lookups and faster routes for simple facts, Hacker News stories,
  and Product Hunt launches. Public-data adapters supply structured evidence where available.
- Cloud image generation through the configured image router, with checks for
  malformed responses, interrupted downloads, and cache failures.
- Markdown links, code fences, and nested workspace documents retain their formatting.

## Reliability

- Replies can continue in the background while another conversation is open.
- Pause cancels replies that are still waiting for location, and completed replies
  finish without waiting for the connection to close.
- Reconnection handles damaged relay data and interrupted replies more carefully.
  Remote history downloads preserve active replies.
- Recovery stays within the conversation's message budget. Thought previews no
  longer clip as easily, and dragging waits until a drag is actually claimed.
- Cloud token usage is recorded persistently, with refresh controls and recovered
  history where records exist. Incomplete historical totals are labeled accordingly.

Choose the installer for your operating system and processor. Existing GitHub
installations can check for signed updates in Settings. Chat, research, image
creation, synchronization, and dictation require an internet connection;
cached conversations remain readable offline.

Windows and macOS preview installers may show trust warnings until platform
certificates are configured. Linux needs a Secret Service keyring to save sign-in
and working microphone support for dictation. Microsoft Store installations receive
updates through the Store after submission and acceptance.
