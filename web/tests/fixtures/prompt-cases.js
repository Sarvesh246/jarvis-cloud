// The example prompts as typed, with the replies models actually give.
export const url = (n) => `https://images.example.com/${n}.jpg`;
export const DESK =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

// The 26 example prompts exactly as a person would type them, each answered
// the way models actually answer: prose, a table, a list or their own card.
export const prompts = {
  styled: "Explain why clear writing matters. Include the main principles, an example quotation, and a few practical suggestions.",
  compare: "Help me choose: Air costs $1,000, lasts 12 hours, and weighs 1.2 kg. Pro costs $1,500, lasts 18 hours, and weighs 1.6 kg. Travel costs $900, lasts 10 hours, and weighs 1.1 kg.",
  bars: "Break down regional growth: North 18%, South −12%, East 27%, West −8%, Central 16%. Which regions drove the result?",
  line: "How did revenue develop over time? January $24,000, February $31,000, March $28,000, April $42,000, May $39,000, June $58,000.",
  stacked: "How much of each month came from subscriptions versus services? January: $18,000 and $8,000. February: $22,000 and $11,000. March: $28,000 and $14,000.",
  figures: "What are the key business numbers here? Revenue $124,830, active users 8,412, refund rate 1.4%, average order $148.",
  timeline: "Help me understand our relaunch schedule: discovery starts November 1, 2026; design November 8; development November 15; testing November 29; launch December 6.",
  widgets: "Explain the assumptions behind this trip plan: two adults sharing one room, three hotel nights, public transport, and meals averaging $40 per day.",
  files: "How should I organize a small JavaScript project containing a main entry point, reusable components, styles, tests, and a README? Give me concrete paths.",
  image: "Keep this image alongside your response and give it a short descriptive caption.",
  board: `Use these photos as studio inspiration: ${url(1)} ${url(2)} ${url(3)}. Explain the direction they suggest.`,
  carousel: `Let me browse these room photos one at a time: ${url(1)} ${url(2)} ${url(3)}.`,
  lens: `Let me look closer at the architectural details in this image: ${url(1)}.`,
  beforeAfter: `What changed between these two room photos? Before: ${url("before")}. After: ${url("after")}.`,
  codeCompare: "What changed between these JavaScript versions? Before: `const total = values.reduce((a,b) => a+b);` After: `const total = values.reduce((a,b) => a+b, 0);` Show both versions with your explanation.",
  qr: "I’m reading https://react.dev/ on my computer and want to open it on my phone.",
  model: "Let me inspect this supplied object from different angles: https://models.example.com/chair.glb.",
  integration: "Propose a workflow to move receipts from Email to Sheets. Explain the source and destination without connecting anything.",
};

export const tree = "my-app/\n  src/\n    main.js\n    components/\n      Button.js\n    styles/\n      app.css\n  tests/\n    main.test.js\n  README.md";

// [label, request, reply, must appear, must not appear]
export const cases = [
  ["bars: prose-only reply", prompts.bars, "East and North drove the result; South and West fell.", "chart-bars", null],
  ["bars: reply with its own table", prompts.bars, "| Region | Growth |\n|---|---:|\n| North | 18% |\n| South | −12% |\n| East | 27% |\n| West | −8% |\n| Central | 16% |\n\nEast led.", "chart-bars", null],
  ["line: model chose overview cards", prompts.line, 'Revenue climbed.\n\n```vaelo-ui\n{"type":"overview","title":"Revenue","items":[{"label":"January","value":"$24,000"},{"label":"June","value":"$58,000"}]}\n```', "line-chart", 'data-kind="overview"'],
  ["line: prose-only reply", prompts.line, "Revenue grew from $24,000 to $58,000.", "line-chart", null],
  ["stacked: prose-only reply", prompts.stacked, "Subscriptions are the larger part each month.", "series-chart", null],
  ["stacked: table with total and share columns", prompts.stacked, "| Month | Subscriptions | Services | Total | Subscription share |\n|---|---:|---:|---:|---:|\n| January | $18,000 | $8,000 | $26,000 | 69% |\n| February | $22,000 | $11,000 | $33,000 | 67% |\n| March | $28,000 | $14,000 | $42,000 | 67% |", "series-chart", null],
  ["figures: prose-only reply", prompts.figures, "Revenue is strong and refunds are low.", 'class="metrics"', null],
  ["timeline: prose-only reply", prompts.timeline, "Work runs in order, ending with launch.", "class=\"timeline\"", null],
  ["timeline: bulleted reply", prompts.timeline, "- **November 1** — Discovery\n- **November 8** — Design\n- **November 15** — Development\n- **November 29** — Testing\n- **December 6** — Launch", "class=\"timeline\"", null],
  ["widgets: prose with a table", prompts.widgets, "The plan rests on a few assumptions.\n\n| Assumption | Detail |\n|---|---|\n| Travelers | Two adults sharing one room |\n| Lodging | Three hotel nights |\n| Transport | Public transport |\n| Meals | About $40 per day |", 'data-kind="widgets"', "<table"],
  ["widgets: bold-led bullets", prompts.widgets, "- **Travelers:** two adults share one room\n- **Lodging:** three hotel nights\n- **Transport:** public transport\n- **Meals:** about $40 per day", 'data-kind="widgets"', null],
  ["files: indented tree in a plain fence", prompts.files, `Here is a layout:\n\n\`\`\`\n${tree}\n\`\`\`\n\nKeep components small.`, 'data-kind="files"', null],
  ["files: tree in a javascript fence", prompts.files, `\`\`\`javascript\n${tree}\n\`\`\``, 'data-kind="files"', null],
  ["files: bullets with descriptions", prompts.files, "Suggested layout:\n\n- `src/main.js` — entry point\n- `src/components/Button.js` — shared UI\n- `src/styles/app.css` — styles\n- `tests/main.test.js` — tests\n- `README.md` — overview", 'data-kind="files"', null],
  ["board: three photos", prompts.board, "They suggest warm minimalism.", "after-masonry", null],
  ["carousel: three photos", prompts.carousel, "Here are the rooms.", "after-carousel", null],
  ["lens: one photo", prompts.lens, "Note the arches.", "data-inspect", null],
  ["before/after: two photos", prompts.beforeAfter, "The room is brighter.", 'data-kind="image-compare"', null],
  ["code compare: inline versions, fenced reply", prompts.codeCompare, "```js\nconst total = values.reduce((a,b) => a+b);\n```\n\n```js\nconst total = values.reduce((a,b) => a+b, 0);\n```\n\nThe initial 0 avoids a crash on empty arrays.", 'data-kind="code-compare"', null],
  ["code compare: inline versions, prose reply", prompts.codeCompare, "The second version passes 0 as the initial value.", 'data-kind="code-compare"', null],
  ["qr", prompts.qr, "Scan the code to open it.", 'data-kind="qr"', null],
  ["3d model", prompts.model, "Rotate it.", 'data-kind="model"', null],
  ["integration flow", prompts.integration, "Nothing is connected.", 'data-kind="integrations"', null],
];

