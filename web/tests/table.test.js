import test from "node:test";
import assert from "node:assert/strict";
import { chartable, isBlank, isDateColumn, isNumericColumn, isSectionRow, tableRowOrder, visibleTableRows, tableView, sortRows, toCSV, toDate, toNumber } from "../src/lib/table.js";
import { safeChartPlan } from "../src/lib/adaptive-ui.js";

const firsts = (rows) => rows.map((row) => row[0]);

const grouped = [["Display", "", ""], ["Size", "6.1", "6.9"], ["Brightness", "1000", "2000"],
  ["Processor & Memory", "", ""], ["RAM", "8", "12"], ["Cores", "6", "8"]];

test("category dividers remain attached to their sorted data rows", () => {
  assert.deepEqual(tableRowOrder(grouped, 1, "desc"), [0, 2, 1, 3, 4, 5]);
  assert.deepEqual(tableRowOrder(grouped, null), [0, 1, 2, 3, 4, 5]);
  assert.ok(isSectionRow(grouped[0]));
  for (const row of [["RAM", "—", "N/A"], ["Size", "6.1", ""], ["2026", "", ""], ["Only column"]])
    assert.equal(isSectionRow(row), false);
});

test("filtering and selection retain only the relevant category dividers", () => {
  assert.deepEqual(visibleTableRows(grouped, "RAM"), [3, 4]);
  assert.deepEqual(visibleTableRows(grouped, "Display"), [0, 1, 2]);
  assert.deepEqual(visibleTableRows(grouped, "", [2, 5], true), [0, 2, 3, 5]);
  assert.deepEqual(visibleTableRows(grouped, "missing"), []);
  assert.deepEqual(visibleTableRows(grouped, "", [], true), []);
});

test("category labels do not stop numeric table data from being charted", () => {
  assert.deepEqual(safeChartPlan(["Category", "Phone A", "Phone B"], grouped), { label: 0, values: [1, 2] });
  assert.match(toCSV(["Category", "A", "B"], grouped), /Display,,/);
});

test("table and chart views share sorted data and count data rows rather than headings", () => {
  const view = tableView(grouped, { column: 1, direction: "desc" });
  assert.deepEqual(view.indices, [0, 2, 1, 3, 4, 5]);
  assert.deepEqual(view.rows.map(row => row[0]), ["Display", "Brightness", "Size", "Processor & Memory", "RAM", "Cores"]);
  assert.equal(view.count, 4);
  assert.equal(view.total, 4);
  assert.deepEqual(grouped[1], ["Size", "6.1", "6.9"], "view transformations preserve the source for exports");
});

test("multiword filters match across category and values regardless of word order", () => {
  assert.deepEqual(tableView(grouped, { query: "1000 DISPLAY" }).indices, [0, 2]);
  const selected = tableView(grouped, { query: "Memory", selected: [4], onlySelected: true });
  assert.deepEqual(selected.indices, [3, 4]);
  assert.equal(selected.count, 1);
  assert.equal(selected.total, 4);
  assert.equal(tableView(grouped, { query: "nothing" }).count, 0);
});

test("text columns sort the way people read them", () => {
  const rows = [["Item 10"], ["item 2"], ["Item 1"], ["Émile"], ["Emma"]];
  assert.deepEqual(firsts(sortRows(rows, 0)), ["Émile", "Emma", "Item 1", "item 2", "Item 10"]);
  assert.deepEqual(firsts(sortRows(rows, 0, "desc")), ["Item 10", "item 2", "Item 1", "Emma", "Émile"]);
});

test("placeholder cells count as blanks, keep a column numeric and sort last", () => {
  for (const value of ["", "—", "–", "-", "N/A", "n/a", "TBD", "?", "unknown"]) assert.ok(isBlank(value), value);
  for (const value of ["0", "Nancy", "No", "-5"]) assert.ok(!isBlank(value), value);
  const rows = [["a", "100"], ["b", "—"], ["c", "20"], ["d", "N/A"], ["e", "3"]];
  assert.ok(isNumericColumn(rows, 1));
  assert.deepEqual(firsts(sortRows(rows, 1)), ["e", "c", "a", "b", "d"]);
  assert.deepEqual(firsts(sortRows(rows, 1, "desc")), ["a", "c", "e", "b", "d"]);
  assert.ok(!isNumericColumn([["—"], ["N/A"]], 0));
});

test("accounting negatives and approximate figures read as numbers", () => {
  assert.equal(toNumber("(1,200)"), -1200);
  assert.equal(toNumber("$(50.5)"), -50.5);
  assert.equal(toNumber("(12%)"), -12);
  assert.equal(toNumber("(0)"), 0);
  assert.equal(toNumber("~40"), 40);
  assert.equal(toNumber("≈ 3.5k"), 3500);
  assert.ok(Number.isNaN(toNumber("(-5)")));
  assert.ok(Number.isNaN(toNumber("(see note)")));
  const rows = [["Q1", "$1,000"], ["Q2", "($250)"], ["Q3", "$40"]];
  assert.deepEqual(firsts(sortRows(rows, 1)), ["Q2", "Q3", "Q1"]);
});

test("dates sort in time order, not alphabetically", () => {
  assert.equal(toDate("2024-03-05"), Date.UTC(2024, 2, 5));
  assert.equal(toDate("2024-03-05T14:30:00Z"), Date.UTC(2024, 2, 5, 14, 30));
  assert.equal(toDate("Mar 5, 2024"), Date.UTC(2024, 2, 5));
  assert.equal(toDate("Tuesday, March 5th, 2024"), Date.UTC(2024, 2, 5));
  assert.equal(toDate("5 Sept. 2024"), Date.UTC(2024, 8, 5));
  assert.equal(toDate("June 2023"), Date.UTC(2023, 5, 1));
  assert.equal(toDate("Q3 2024"), Date.UTC(2024, 6, 1));
  assert.equal(toDate("2024 Q1"), Date.UTC(2024, 0, 1));
  // Ambiguous or not dates at all
  for (const value of ["03/05/2024", "2023-24", "2024-13-01", "March", "Maybe 2024", "May the 4th"])
    assert.ok(Number.isNaN(toDate(value)), value);

  const rows = [["launch", "Jan 2025"], ["beta", "Sep 12, 2024"], ["alpha", "Mar 3, 2024"], ["later", "TBD"]];
  assert.ok(isDateColumn(rows, 1));
  assert.deepEqual(firsts(sortRows(rows, 1)), ["alpha", "beta", "launch", "later"]);
  assert.deepEqual(firsts(sortRows(rows, 1, "desc")), ["launch", "beta", "alpha", "later"]);
  // Years alone are figures, not dates
  assert.ok(!isDateColumn([["2019"], ["2021"]], 0));
  // One stray word makes it a text column
  assert.ok(!isDateColumn([["Jan 2025"], ["Soon"]], 0));
});

test("sorting keeps the original order for ties and leaves the input alone", () => {
  const rows = [["a", "1"], ["b", "1"], ["c", "0"]];
  assert.deepEqual(firsts(sortRows(rows, 1)), ["c", "a", "b"]);
  assert.deepEqual(firsts(rows), ["a", "b", "c"]);
  assert.equal(sortRows(rows, null), rows);
});

test("years name the rows of a chart instead of being charted", () => {
  const revenue = [["2022", "$1.2M"], ["2023", "$1.9M"], ["2024", "$2.4M"]];
  assert.deepEqual(chartable(["Year", "Revenue"], revenue), { label: 0, values: [1] });
  assert.deepEqual(chartable(["Period", "Revenue"], revenue), { label: 0, values: [1] });
  assert.deepEqual(
    chartable(["City", "Founded", "Population"], [["Austin", "1839", "974,000"], ["Denver", "1858", "716,000"]]),
    { label: 0, values: [2] },
  );
  assert.equal(chartable(["Year", "Season"], [["2022", "2023"], ["2024", "2025"]]), null);
  // An ordinary count that happens to be four digits is still charted
  assert.deepEqual(chartable(["Team", "Points"], [["A", "1200"], ["B", "2450"]]), { label: 0, values: [1] });
});

test("CSV keeps accounting negatives as figures, not formulas", () => {
  assert.equal(toCSV(["x"], [["(1,200)"], ["-5"], ["=A1"]]), 'x\r\n"(1,200)"\r\n-5\r\n\'=A1');
});
