import assert from "node:assert/strict";
import test from "node:test";
import { metricsText, parseMetrics, parseTimeline, plainLine, timelineText } from "../src/lib/structured.js";

test("figures written with Markdown emphasis read as plain labels and values", () => {
  const data = parseMetrics(
    [
      "# **Q3 results**",
      "**Revenue:** $4.2B (+8%)",
      "- **Margin**: *31%*",
      "`EPS`: [$1.12](https://example.com/q3)",
      "Units: 5 * 3 crates",
    ].join("\n"),
  );
  assert.equal(data.title, "Q3 results");
  assert.deepEqual(data.items, [
    { label: "Revenue", value: "$4.2B", delta: "+8%", direction: "up" },
    { label: "Margin", value: "31%" },
    { label: "EPS", value: "$1.12" },
    // a lone asterisk is arithmetic, not emphasis
    { label: "Units", value: "5 * 3 crates" },
  ]);
  assert.deepEqual(data.extra, []);
});

test("a figure block keeps lines it can't read as figures instead of dropping them", () => {
  const data = parseMetrics("Revenue: $4.2B\nFigures are unaudited\nhttps://example.com/report");
  assert.deepEqual(data.items, [{ label: "Revenue", value: "$4.2B" }]);
  assert.deepEqual(data.extra, ["Figures are unaudited", "https://example.com/report"]);
  assert.equal(metricsText(data), "Revenue: $4.2B\nFigures are unaudited\nhttps://example.com/report");
  // a block with no figures at all still has its words to show
  assert.deepEqual(parseMetrics("Nothing to measure yet").extra, ["Nothing to measure yet"]);
});

test("timelines read bold dates, dashed dates and keep undated lines", () => {
  const data = parseTimeline(
    [
      "# **Company history**",
      "- **2019:** Founded in Lyon",
      "* 2021 — Series A — €12M",
      "Then things slowed down",
      "*March 2023*: Profitable",
      "Founded — in a garage",
    ].join("\n"),
  );
  assert.equal(data.title, "Company history");
  assert.deepEqual(data.events, [
    { when: "2019", what: "Founded in Lyon" },
    { when: "2021", what: "Series A", detail: "€12M" },
    { when: "March 2023", what: "Profitable" },
  ]);
  // a dash only marks a date when there is a date before it
  assert.deepEqual(data.extra, ["Then things slowed down", "Founded — in a garage"]);
  // a finished block shows undated lines where they were written
  assert.deepEqual(
    data.rows.map((row) => row.when || row.what),
    ["2019", "2021", "Then things slowed down", "March 2023", "Founded — in a garage"],
  );
  assert.equal(
    timelineText(data),
    "Company history\n2019: Founded in Lyon\n2021: Series A — €12M\nThen things slowed down\nMarch 2023: Profitable\nFounded — in a garage",
  );
});

test("plain lines lose only paired marks", () => {
  assert.equal(plainLine("**Price:** $1"), "Price: $1");
  assert.equal(plainLine("__Total__: 12"), "Total: 12");
  assert.equal(plainLine("my_variable_name: 3"), "my_variable_name: 3");
  assert.equal(plainLine("~~$10~~ $8"), "$10 $8");
  assert.equal(plainLine("[Wiki](https://en.wikipedia.org/wiki/Foo_(bar)) page"), "Wiki page");
  // half-streamed emphasis is left as it is until its closing mark arrives
  assert.equal(plainLine("**Reven"), "**Reven");
});
