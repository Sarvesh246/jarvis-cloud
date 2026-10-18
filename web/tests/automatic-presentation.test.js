import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import {
  automaticPresentation,
  suppliedCosts,
  requestedFactor,
  dataFences,
} from "../src/lib/automatic-presentation.js";
import {
  richGuidanceFor,
  richPresentationFor,
} from "../shared/rich-ui-guidance.js";
import { parseRichUI, richPayload } from "../src/lib/rich-ui.js";
import { automaticSamples } from "./fixtures/automatic-samples.js";

test("cost recovery excludes derived totals, refuses mixed currencies and initializes the stated split", () => {
  assert.deepEqual(
    suppliedCosts("Hotel: $480\nFood: $160\nTotal: $640").items,
    [
      { label: "Hotel", amount: 480 },
      { label: "Food", amount: 160 },
    ],
  );
  assert.equal(suppliedCosts("Hotel $480, food €160"), null);
  assert.equal(suppliedCosts("The sum is $480 + $160 = $640"), null);
  const result = automaticPresentation(
    "The total is $715.",
    automaticSamples[21][1],
  );
  assert.equal(result.block.people, 2);
  assert.deepEqual(
    result.block.items.map((x) => x.amount),
    [480, 160, 75],
  );
  assert.equal(requestedFactor("What if spending increased by 25%?"), 1.25);
  assert.equal(requestedFactor("What if costs decreased by 20%?"), 0.8);
});

test("selection recovers ordinary model prose and requires actual media inputs", () => {
  for (const i of [9, 10, 11, 12, 14, 15, 16, 17, 20, 21, 22, 23, 24]) {
    const [name, request, answer] = automaticSamples[i];
    assert.ok(automaticPresentation(answer, request)?.block, name);
  }
  assert.equal(
    automaticPresentation(
      "I cannot find suitable images.",
      "Give me studio inspiration.",
    ),
    null,
  );
  assert.equal(
    automaticPresentation(
      "No model URL was supplied.",
      "Let me inspect a 3D model.",
    ),
    null,
  );
  assert.equal(
    automaticPresentation(
      "Need the second version.",
      "What changed between these code versions?",
    ),
    null,
  );
  for (const request of [
    "Give me a quick summary. Plain text only.",
    "Return raw JSON.",
    "Just the answer.",
  ])
    assert.equal(
      automaticPresentation("Hotel: $480\nFood: $160", request),
      null,
    );
  assert.equal(
    automaticPresentation("x".repeat(60001), "Summarize these results."),
    null,
  );
  assert.equal(automaticPresentation("Hello!", "Hi!"), null);
});

test("valid payloads do not get duplicated; omitted type is repaired only when the rest of the selected schema validates", () => {
  const receipt = {
    currency: "USD",
    items: [
      { label: "Food", amount: 20 },
      { label: "Travel", amount: 10 },
    ],
  };
  const request = "Split these expenses between two people.";
  assert.equal(parseRichUI(JSON.stringify(receipt)), null);
  assert.equal(
    richPayload(JSON.stringify(receipt), "json", request)?.type,
    "receipt",
  );
  assert.equal(
    richPayload(
      JSON.stringify({
        ...receipt,
        items: [{ label: "Food", amount: "unknown" }],
      }),
      "json",
      request,
    ),
    null,
  );
  assert.equal(
    richPayload(JSON.stringify(receipt), "javascript", request),
    null,
  );
  assert.equal(
    richPayload(JSON.stringify(receipt), "json", request + " Return raw JSON."),
    null,
  );
  assert.equal(
    automaticPresentation(
      "~~~json\n" + JSON.stringify({ ...receipt, type: "receipt" }) + "\n~~~",
      request,
    ),
    null,
  );
  assert.equal(
    automaticPresentation(
      "~~~json\n" + JSON.stringify(receipt) + "\n~~~",
      request,
    ),
    null,
  );
  const nested = "````markdown\n```js\nx()\n```\n````";
  assert.equal(dataFences(nested).length, 1);
  assert.equal(dataFences(nested)[0].language, "markdown");
});

test("every selected rich style has concrete valid schema guidance for natural requests", () => {
  const examples = new Map();
  for (const [, request] of automaticSamples) {
    const selected = richPresentationFor(request);
    if (!selected) continue;
    const guidance = richGuidanceFor([{ role: "user", content: request }]);
    assert.ok(guidance.includes('"type":"' + selected + '"'), selected);
    const objects = [...guidance.matchAll(/```vaelo-ui\n([^`]+)\n```/g)].map(
      (m) => JSON.parse(m[1]),
    );
    assert.ok(
      objects.some(
        (x) => x.type === selected && parseRichUI(JSON.stringify(x)),
      ),
      selected,
    );
    examples.set(selected, true);
  }
  assert.equal(examples.size, 12);
});

test("all 26 natural requests reach actual chat visuals without relying on model UI payloads", async () => {
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
    for (const [name, requestText, content, selector] of automaticSamples) {
      const html = renderToStaticMarkup(
        React.createElement(Message, {
          message: {
            id: "auto-" + name,
            role: "assistant",
            content,
            createdAt: 1,
          },
          requestText,
          isLast: true,
          busy: false,
          live: false,
          onAction() {},
        }),
      );
      assert.ok(html.includes(selector), name + " expected " + selector);
      assert.doesNotMatch(html, /block-fallback|block-plain/, name);
      const plain = renderToStaticMarkup(
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
        plain,
        /class="after-block"|class="after-steps"|class="inline-preview"|class="local-explorer"/,
        name + " minimal",
      );
    }
    const requestText = automaticSamples[21][1];
    for (const props of [{ live: true }, { mapped: true }]) {
      const html = renderToStaticMarkup(
        React.createElement(Rendered, {
          content: "Total is $715.",
          requestText,
          sources: [],
          onOpen() {},
          ...props,
        }),
      );
      assert.doesNotMatch(html, /data-kind="receipt"/);
    }
  } finally {
    await server.close();
  }
});
