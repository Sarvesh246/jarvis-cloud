import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { automaticPresentation } from "../src/lib/automatic-presentation.js";
import { seriesTable, suppliedFigures, suppliedDates } from "../shared/supplied-data.js";
import { richGuidanceFor } from "../shared/rich-ui-guidance.js";
import { treePaths } from "../src/lib/rich-ui.js";
import { prompts, cases, tree, DESK } from "./fixtures/prompt-cases.js";

test("supplied figures are read from the request, never invented", () => {
  assert.deepEqual(seriesTable(prompts.bars).columns, ["Region", "Growth"]);
  assert.equal(seriesTable(prompts.bars).rows.length, 5);
  assert.deepEqual(seriesTable(prompts.line).columns, ["Month", "Revenue"]);
  assert.deepEqual(seriesTable(prompts.stacked).columns, ["Month", "Subscriptions", "Services"]);
  assert.equal(seriesTable(prompts.compare), null, "mixed units stay a comparison");
  assert.equal(seriesTable(prompts.widgets), null);
  assert.equal(suppliedFigures(prompts.figures).length, 4);
  assert.equal(suppliedFigures(prompts.timeline), null);
  assert.equal(seriesTable(prompts.timeline), null, "dates are not a series");
  assert.equal(suppliedDates(prompts.timeline).length, 5);
  assert.equal(suppliedDates(prompts.timeline)[1].when, "November 8, 2026");
});

test("trees written as outlines, bullets or box drawings all become file lists", () => {
  assert.equal(treePaths(tree, "text").paths.length, 5);
  assert.equal(treePaths("- Confirm venue\n- Send invitations\n- Arrange equipment"), null);
  assert.equal(treePaths("mkdir project\ncd project\ngit init", "bash"), null);
});

test("figures typed into the request keep a chart out of prose, and plain asks stay plain", () => {
  assert.match(automaticPresentation("Growth varied.", prompts.bars).markdown, /^\| Region \| Growth \|/);
  assert.equal(automaticPresentation("Growth varied.", prompts.bars + " Plain text only."), null);
  assert.equal(automaticPresentation("Prose.", prompts.compare), null);
  assert.equal(automaticPresentation("Clarity helps.", prompts.styled), null);
});

test("guidance tells the model which plain shape draws as the right visual", () => {
  const last = (content) => richGuidanceFor([{ role: "user", content }]);
  assert.match(last(prompts.bars), /Markdown table[\s\S]*bar chart/);
  assert.match(last(prompts.line), /Markdown table[\s\S]*line chart/);
  assert.match(last(prompts.stacked), /stacked chart/);
  assert.match(last(prompts.figures), /metrics block/);
  assert.match(last(prompts.files), /"type":"files"/);
  assert.match(last(prompts.widgets), /"type":"widgets"/);
});

test("every example prompt reaches its visual however the model answers", async () => {
  const server = await createServer({
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: "custom",
  });
  try {
    const { Message } = await server.ssrLoadModule("/src/components/Message.jsx");
    const render = (reply, requestText, extra = {}) =>
      renderToStaticMarkup(
        React.createElement(Message, {
          message: { id: "m", role: "assistant", content: reply, createdAt: 1 },
          requestText,
          isLast: true,
          busy: false,
          live: false,
          onAction() {},
          ...extra,
        }),
      );
    for (const [label, request, reply, expected, forbidden] of cases) {
      const html = render(reply, request);
      assert.ok(html.includes(expected), `${label}: expected ${expected}`);
      if (forbidden) assert.ok(!html.includes(forbidden), `${label}: unexpected ${forbidden}`);
      assert.doesNotMatch(html, /block-fallback|block-plain/, label);
    }
    // The bar-chart reply keeps its written takeaway beside the drawn chart.
    assert.match(render("East led.", prompts.bars), /East led\./);
    // An attached image stays beside its caption.
    const withImage = render("A tidy desk with a lamp.", prompts.image, {
      requestImages: [{ src: DESK, alt: "desk.jpg" }],
    });
    assert.match(withImage, /<img[^>]+src="data:image\/png;base64,/);
    assert.match(withImage, /A tidy desk with a lamp\./);
    assert.ok(!render("A tidy desk.", prompts.image).includes("<img"), "no attachment, no image");
  } finally {
    await server.close();
  }
});
