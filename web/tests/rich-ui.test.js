import { readFileSync } from 'node:fs';
import test from "node:test";
import assert from "node:assert/strict";
import {
  parseRichUI,
  safeMedia,
  fileTree,
  movePinned,
  stackedSeries,
  richPayload, pendingRichPayload, wantsSourceReply, reorderAt,
} from "../src/lib/rich-ui.js";
import { richGuidanceFor } from "../shared/rich-ui-guidance.js";
import { parseFences } from '../src/lib/library.js';

const parse = (data) => parseRichUI(JSON.stringify(data));
test('data fences tolerate model labels without intercepting requested source or executable code', () => {
  const payload = JSON.stringify({type:'overview',items:[{label:'Hotel',value:'$480'}]});
  for (const language of ['', 'json', 'application/json', 'ui', 'vaelo-ui', 'overview', 'bento']) assert.ok(richPayload(payload, language));
  for (const language of ['javascript', 'jsx', 'python', 'html']) assert.equal(richPayload(payload, language), null);
  for (const request of ['Return only JSON.', 'Respond with JSON.', 'Reply in valid JSON.', 'Show me the JSON.', 'Use raw JSON.', 'Give me source code.', 'Show example JSON.', 'JSON schema']) {
    assert.ok(wantsSourceReply(request), request);
    assert.equal(richPayload(payload, 'json', request), null);
    assert.equal(pendingRichPayload(payload, 'json', request), false);
  }
  for (const request of ['Show a bento overview.', 'Show a QR code.', 'Compare this source code.']) assert.equal(wantsSourceReply(request), false);
  assert.ok(pendingRichPayload('{"type":"overview","items":[', 'json'));
  assert.equal(pendingRichPayload('{"type":"unknown","items":[', 'json'), false);
  assert.equal(pendingRichPayload('{"type":"overview","items":[', 'javascript'), false);
  assert.deepEqual(parse({type:'Bento',items:[{label:'Days',value:4}]}), {type:'overview',items:[{label:'Days',value:'4'}]});
  assert.equal(parse({component:'qr-code',url:'https://react.dev/'}).type, 'qr');
  const content = `~~~json\n${payload}\n~~~`;
  assert.deepEqual(parseFences(content), []);
  assert.equal(parseFences(content, 'Return only JSON.').length, 1);
});
test('pointer ordering inserts on either side, preserving identity and avoiding redundant updates', () => {
  const ids = ['a','b','c'];
  assert.deepEqual(reorderAt(ids,'a','c',true), ['b','c','a']);
  assert.deepEqual(reorderAt(ids,'c','a'), ['c','a','b']);
  assert.strictEqual(reorderAt(ids,'a','b'), ids);
  assert.strictEqual(reorderAt(ids,'a','a'), ids);
  assert.strictEqual(reorderAt(ids,'missing','a'), ids);
  assert.deepEqual(ids, ['a','b','c']);
});
test("rich blocks validate every supported shape and preserve supplied facts", () => {
  const examples = [
    ...["overview", "widgets", "integrations"].map((type) => ({
      type,
      items: [{ label: "Files", value: "2", detail: "Supplied" }],
    })),
    { type: "steps", items: ["Open settings", "Choose a theme"] },
    {
      type: "graph",
      nodes: [
        { id: "a", label: "Browser" },
        { id: "b", label: "Server" },
      ],
      edges: [{ from: "a", to: "b" }],
    },
    { type: "files", paths: ["src/App.jsx", "src/design/tokens.css"] },
    {
      type: "gallery",
      images: [{ src: "https://example.com/a.png", alt: "A" }],
    },
    {
      type: "image-compare",
      before: { src: "https://example.com/a.png", alt: "Before" },
      after: { src: "https://example.com/b.png", alt: "After" },
    },
    { type: "code-compare", before: "const n = 1;", after: "const n = 2;" },
    {
      type: "receipt",
      currency: "USD",
      items: [{ label: "Food", amount: 12.34 }],
    },
    { type: "qr", url: "https://example.com/" },
    { type: "model", src: "https://example.com/model.glb", alt: "Model" },
  ];
  for (const example of examples) assert.deepEqual(parse(example), example);
});
test("unsafe media, malformed payloads and excessive work fall back to original text", () => {
  for (const value of [
    "javascript:alert(1)",
    "data:image/svg+xml,test",
    "file:///secret",
    "http://example.com/a",
    "https://user:pass@example.com/a",
  ])
    assert.equal(safeMedia(value), null);
  for (const data of [
    null,
    [],
    { type: "unknown" },
    { type: "gallery", images: [] },
    { type: "steps", items: Array(41).fill("x") },
    { type: "overview", items: [{ label: "A", value: { html: "bad" } }] },
    { type: "qr", url: "https://example.com/" + "a".repeat(1800) },
    { type: "model", src: "https://example.com/model.html", alt: "x" },
    { type: "code-compare", before: "x".repeat(8001), after: "a" },
    { type: "receipt", currency: "?", items: [{ label: "A", amount: 1 }] },
    { type: "receipt", currency: "USD", items: [{ label: "A", amount: "12" }] },
  ])
    assert.equal(parse(data), null);
  assert.equal(parseRichUI("{unfinished"), null);
  assert.equal(parseRichUI("x".repeat(60001)), null);
});
test("diagrams refuse invented endpoints and duplicate node identities", () => {
  assert.equal(
    parse({
      type: "graph",
      nodes: [{ id: "a", label: "A" }],
      edges: [{ from: "a", to: "missing" }],
    }),
    null,
  );
  assert.equal(
    parse({
      type: "graph",
      nodes: [
        { id: "a", label: "A" },
        { id: "a", label: "B" },
      ],
      edges: [{ from: "a", to: "a" }],
    }),
    null,
  );
});
test("file trees group common folders and treat prototype names as data", () => {
  const tree = fileTree([
    "src/App.jsx",
    "src/ui/Button.jsx",
    "__proto__/constructor",
  ]);
  assert.ok(tree.get("src").has("App.jsx"));
  assert.ok(tree.get("src").get("ui").has("Button.jsx"));
  assert.ok(tree.get("__proto__").has("constructor"));
  assert.equal({}.polluted, undefined);
});
test("pinned reorder preserves identities and refuses out of range moves", () => {
  const ids = ["a", "b", "c"];
  assert.deepEqual(movePinned(ids, "b", -1), ["b", "a", "c"]);
  assert.deepEqual(movePinned(ids, "b", 1), ["a", "c", "b"]);
  assert.deepEqual(movePinned(ids, "a", -1), ids);
  assert.deepEqual(movePinned(ids, "missing", 1), ids);
  assert.deepEqual(ids, ["a", "b", "c"]);
});
test("stacked charts reject mixed units, percentages, negatives and missing entries", () => {
  const columns = ["Month", "Rent", "Food"];
  const rows = [
    ["Jan", "$1200", "$300"],
    ["Feb", "$1200", "$280"],
  ];
  const result = stackedSeries(columns, rows, [1, 2], 0);
  assert.equal(result.max, 1500);
  assert.deepEqual(result.points[0].original, ["$1200", "$300"]);
  for (const values of [
    ["$1", "€2"],
    ["1%", "2%"],
    ["-1", "2"],
    ["n/a", "2"],
  ])
    assert.equal(stackedSeries(columns, [["Jan", ...values]], [1, 2], 0), null);
  assert.equal(stackedSeries(columns, rows, [1], 0), null);
});
test("simple requests keep their prompt budget; useful rich formats are discovered automatically", () => {
  const msg = (content) => [{ role: "user", content }];
  assert.equal(richGuidanceFor(msg("Help me pack for a weekend.")), "");
  assert.equal(
    richGuidanceFor(msg("Make a bento overview in plain text.")),
    "",
  );
  assert.match(
    richGuidanceFor(msg("Make a code comparison for these two versions.")),
    /code-compare/,
  );
  assert.match(
    richGuidanceFor(msg("Show a relationship graph.")),
    /never invent|do not invent/i,
  );
  assert.equal(
    richGuidanceFor([
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Show a code diff" },
    ]),
    "",
  );
});


test('production policy permits HTTPS previews while preserving execution boundaries', () => {
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const csp = config.headers.flatMap(rule => rule.headers).find(header => header.key === 'Content-Security-Policy').value;
  const directives = new Map(csp.split(';').map(part => { const [name, ...values] = part.trim().split(/\s+/); return [name, values]; }));
  assert.ok(directives.get('img-src').includes('https:'));
  assert.ok(directives.get('connect-src').includes('https:'));
  assert.ok(directives.get('connect-src').includes('blob:'));
  assert.deepEqual(directives.get('worker-src'), ["'self'", 'blob:']);
  assert.deepEqual(directives.get('script-src'), ["'self'", "'wasm-unsafe-eval'", 'https://accounts.google.com/gsi/client']);
  assert.deepEqual(directives.get('frame-src'), ["'self'", 'https://accounts.google.com']);
  assert.deepEqual(directives.get('object-src'), ["'none'"]);
  assert.deepEqual(directives.get('form-action'), ["'self'"]);
  assert.ok(!directives.get('script-src').includes("'unsafe-eval'"));
});

test('a drawn grid in a plain fence is recovered as overview cards', async () => {
  const { gridOverview, parseRichUI } = await import('../src/lib/rich-ui.js');
  const drawn = '┌───────┬──────┐\n│ Hotel │ $480 │\n├───────┼──────┤\n│ Food  │ $160 │\n│ **Total** │ **$715** │\n└───────┴──────┘';
  const grid = gridOverview(drawn, '');
  assert.deepEqual(grid.items.map((x) => x.label), ['Hotel', 'Food', 'Total']);
  assert.ok(parseRichUI(JSON.stringify(grid)));
  assert.equal(gridOverview(drawn, 'python'), null);
  assert.equal(gridOverview('a | b | c | d\n1 | 2 | 3 | 4', ''), null);
});
