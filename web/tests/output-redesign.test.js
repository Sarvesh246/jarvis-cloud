import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  percentageShares,
  bestTableCells,
  timelineLayout,
  timelineDate,
  barScale,
  smoothChartPath,
} from "../src/lib/output-redesign.js";
import {
  RICH_UI_GUIDANCE,
  richGuidanceFor,
  richPresentationFor,
} from "../shared/rich-ui-guidance.js";
import { samples } from "./fixtures/redesign-samples.js";
import { parseRichUI, richPayload } from "../src/lib/rich-ui.js";

test("chart scales keep finite bounds and line fills follow the same smooth path", () => {
  assert.equal(barScale(14.1), 15);
  for (const value of [0, 1, 27, 1e308, Number.MIN_VALUE])
    assert.ok(Number.isFinite(barScale(value)) && barScale(value) >= value);
  const path = smoothChartPath("0,20 10,10 20,15");
  assert.match(path, /^M 0 20 C/);
  assert.ok(!/NaN|Infinity/.test(path));
  assert.equal(smoothChartPath("invalid"), "");
});

test("derived shares and best-value marks use only comparable supplied figures", () => {
  assert.deepEqual(percentageShares([480, 160, 75]), [67, 22, 11]);
  assert.equal(percentageShares([0, 0]), null);
  assert.equal(percentageShares([-1, 2]), null);
  const cols = ["Model", "Price", "Battery", "Score", "Users"];
  const rows = [
    ["A", "$100", "12 h", "90", "5"],
    ["B", "$80", "15 h", "85", "10"],
  ];
  // Dimensional suffixes are read consistently by the table's number parser.
  const best = bestTableCells(cols, rows, [0, 1]);
  assert.ok(best.has("1:1"));
  assert.ok(best.has("0:3"));
  assert.ok(best.has("1:2"));
  assert.ok(!best.has("1:4"), "an arbitrary number is not called best");
  assert.equal(bestTableCells(["Price"], [["$80"], ["€60"]], [0, 1]).size, 0);
});
test("timeline dates do not invent a year, a completion state, or a date for undated material", () => {
  assert.equal(timelineDate("Mar 3"), null);
  assert.equal(timelineDate("2026-02-30"), null);
  const plan = timelineLayout(
    [
      { when: "2026-10-05", what: "Discovery" },
      { when: "2026-10-18", what: "[current] Review" },
      { when: "2026-11-01", what: "Launch" },
      { when: "", what: "Unscheduled" },
    ],
    new Date("2026-10-18T12:00:00"),
  );
  assert.deepEqual(
    plan.events.map((e) => e.status),
    ["past", "current", "upcoming", null],
  );
  assert.equal(plan.events[1].what, "Review");
  assert.ok(plan.today > 0 && plan.today < 100);
  assert.equal(plan.events[3].relative, "");
});
test("natural requests receive rich schemas without naming a component", () => {
  for (const request of [
    "Walk me through renewing my passport.",
    "How do these services depend on each other?",
    "Show the project structure.",
    "Give me an inspiration board.",
    "Split the bill between three people.",
    "Open these docs on my phone.",
    "How could these systems work together?",
    "Here are the amounts from our weekend together; help us understand and settle them.",
  ]) {
    assert.match(
      richGuidanceFor([{ role: "user", content: request }]),
      /Choose these cards automatically/,
      request,
    );
  }
  for (const request of [
    "Hi",
    "2+2",
    "Help me pack for a weekend.",
    "Show the project structure in plain text.",
    "Show an image board, no widgets.",
  ])
    assert.equal(richGuidanceFor([{ role: "user", content: request }]), "");
});

test("automatic intent chooses a concrete view and the schema example is parseable JSON", () => {
  const cases = [
    [
      "We paid $480 for the hotel and $160 for food. Split this trip bill between two people.",
      "receipt",
    ],
    [
      "Our browser calls the API. The API reads PostgreSQL and checks Redis. Explain how these services fit together.",
      "graph",
    ],
    [
      "Walk me through creating a project and committing its first files.",
      "steps",
    ],
    ["Show the project structure.", "files"],
    ["Open https://react.dev on my phone.", "qr"],
    ["Give me an inspiration board.", "gallery"],
    ["How could these systems work together?", "integrations"],
  ];
  for (const [prompt, kind] of cases) {
    assert.equal(richPresentationFor(prompt), kind);
    assert.match(
      richGuidanceFor([{ role: "user", content: prompt }]),
      new RegExp(`Presentation for this reply: use the ${kind} view`),
    );
    assert.equal(richPresentationFor(`${prompt} In plain text only.`), null);
  }
  const example = RICH_UI_GUIDANCE.match(/```vaelo-ui\n([\s\S]*?)\n```/);
  assert.ok(example);
  assert.equal(JSON.parse(example[1]).type, "overview");
});

test("provider-escaped declarative JSON decodes once without leaking syntax or changing strings", () => {
  const data = {
    type: "steps",
    items: ["Run `git init`.", 'Write "A project" to README.\nThen commit.'],
  };
  const ordinary = JSON.stringify(data),
    wrapped = JSON.stringify(ordinary),
    escaped = wrapped.slice(1, -1);
  assert.deepEqual(parseRichUI(escaped), data);
  assert.deepEqual(parseRichUI(wrapped), data);
  assert.ok(richPayload(escaped, "vaelo-ui"));
  assert.equal(richPayload(escaped, "vaelo-ui", "Return raw JSON."), null);
  assert.equal(parseRichUI('{\\"type\\":\\"steps\\",broken}'), null);
  const receipt = {type:'receipt',currency:'USD',people:2,items:[{label:'Food',amount:60}]};
  assert.deepEqual(parseRichUI(JSON.stringify(receipt)),receipt);
  assert.equal(parseRichUI(JSON.stringify({...receipt,people:0})),null);
  assert.equal(parseRichUI(JSON.stringify({type:'widgets',items:[{label:'Detail',value:'Given',chips:[{}]}]})),null);
});
test("all 26 designs reach the actual chat message without renderer fallback or leaked payloads", async () => {
  const server = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
  });
  try {
    const { Message } = await server.ssrLoadModule(
      "/src/components/Message.jsx",
    );
    const { Rendered, PresentationContext } = await server.ssrLoadModule(
      "/src/components/blocks/Blocks.jsx",
    );
    for (const [name, requestText, content] of samples) {
      const html = renderToStaticMarkup(
        React.createElement(Message, {
          message: { id: name, role: "assistant", content },
          requestText,
          isLast: true,
          onAction() {},
        }),
      );
      assert.match(html, /aria-label="Vaelo"/, name);
      assert.doesNotMatch(html, /block-fallback/, name);
      assert.doesNotMatch(html, /&quot;type&quot;:/, name);
      assert.ok(html.includes("Copy"), name);
      const minimal = renderToStaticMarkup(
        React.createElement(
          PresentationContext.Provider,
          { value: "minimal" },
          React.createElement(Rendered, {
            content,
            requestText,
            sources: [],
            onOpen() {},
          }),
        ),
      );
      assert.doesNotMatch(
        minimal,
        /class="after-block"|class="inline-preview"/,
        name,
      );
    }
    const render = (content) =>
      renderToStaticMarkup(
        React.createElement(Rendered, { content, sources: [], onOpen() {} }),
      );
    assert.doesNotMatch(
      render("## Notes\n\n- Deposit window\n- Appliance repairs"),
      /local-checklist/,
    );
    assert.match(
      render("## Next steps\n\n- Gather notes\n- Send invitations"),
      /local-checklist/,
    );
    assert.match(render("```html\n<h1>Hello</h1>\n```"), /sandbox=""/);
    const codedWalkthrough = renderToStaticMarkup(React.createElement(Rendered, {
      content: '1. **Check Git**\n\n   ```bash\n   git --version\n   ```\n\n   Confirm a version is printed.\n\n2. **Create folder**\n\n   ```bash\n   mkdir project\n   ```',
      requestText: 'Walk me through making my first Git commit, one step at a time.', sources: [], onOpen() {},
    }));
    assert.match(codedWalkthrough, /class="after-steps"/);
    assert.match(codedWalkthrough.replace(/<[^>]+>/g, ''), /git --version/);
    assert.match(codedWalkthrough, /code-line-number/);
    assert.match(render('```javascript filename="settle.js"\nconst total = 2;\n```'), /settle\.js/);
    assert.match(
      render("```javascript\nfunction sum() {\n  return 2;\n}\n```"),
      /code-line-number/,
    );
  } finally {
    await server.close();
  }
});
