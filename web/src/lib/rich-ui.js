import { numberSeries } from "./intelligent-ui.js";
import { richPresentationFor } from '../../shared/rich-ui-guidance.js';
// Bounded, declarative content only. A reply cannot supply HTML, handlers or executable code.
export const RICH_TYPES = new Set([
  "overview",
  "widgets",
  "steps",
  "graph",
  "files",
  "gallery",
  "image-compare",
  "code-compare",
  "receipt",
  "qr",
  "model",
  "integrations",
  "audio",
  "question",
]);
const RICH_ALIASES = { bento: 'overview', 'bento-grid': 'overview', summary: 'overview', 'widget-stack': 'widgets', 'file-tree': 'files', 'image-gallery': 'gallery', 'image-comparison': 'image-compare', 'code-comparison': 'code-compare', diff: 'code-compare', network: 'graph', 'qr-code': 'qr', 'model-viewer': 'model' };
export function safeMedia(value, kind = "image") {
  if (typeof value !== "string" || value.length > 4096) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (kind === "model" && !/\.glb$/i.test(url.pathname)) return null;
    return url.href;
  } catch {
    return null;
  }
}
export function parseRichUI(source, expectedType) {
  if (typeof source !== "string" || source.length > 60000) return null;
  try {
    let data;
    try { data = JSON.parse(source); }
    catch {
      // Some providers serialize the whole object as a JSON string, then omit
      // its outer quotes. Decode one complete JSON escaping layer, never eval.
      if (!/^\s*\{\s*\\"/.test(source)) return null;
      const decoded = JSON.parse('"' + source.trim().replace(/\r/g,'\\r').replace(/\n/g,'\\n').replace(/\t/g,'\\t') + '"');
      data = JSON.parse(decoded);
    }
    if (typeof data === 'string' && data.length <= 60000) data = JSON.parse(data);
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const type = data.type || data.component || (RICH_TYPES.has(expectedType) ? expectedType : undefined);
      if (typeof type === 'string') data = { ...data, type: RICH_ALIASES[type.toLowerCase()] || type.toLowerCase() };
      if (['overview', 'widgets', 'integrations'].includes(data.type) && Array.isArray(data.items)) data = { ...data, items: data.items.map(item => item && typeof item === 'object' ? { ...item, value: typeof item.value === 'number' && Number.isFinite(item.value) ? String(item.value) : item.value } : item) };
    }
    if (!data || Array.isArray(data) || !RICH_TYPES.has(data.type)) return null;
    const text = (v) => typeof v === "string" && v.length <= 8000;
    const items = (key = "items", max = 40) =>
      Array.isArray(data[key]) &&
      data[key].length > 0 &&
      data[key].length <= max;
    if (data.title !== undefined && !text(data.title)) return null;
    switch (data.type) {
      case 'audio':
        if (!safeMedia(data.src) || !/\.(?:mp3|wav|ogg|m4a|aac|flac)$/i.test(new URL(data.src).pathname)) return null;
        break;
      case 'question':
        if (!items('options', 6) || data.options.length < 2 || !data.options.every(x => text(x) && x.trim() && x.length <= 180) || new Set(data.options).size !== data.options.length) return null;
        if (data.details !== undefined && (!Array.isArray(data.details) || data.details.length !== data.options.length || !data.details.every(value => text(value) && value.length <= 1000))) return null;
        break;
      case "overview":
      case "widgets":
      case "integrations":
        if (
          !items("items", 12) ||
          !data.items.every(
            (x) =>
              x &&
              text(x.label) &&
              text(x.value) &&
              (x.chips === undefined || (Array.isArray(x.chips) && x.chips.length <= 8 && x.chips.every(text))) &&
              (data.type !== 'integrations' || x.direction === undefined || ['source','destination'].includes(x.direction)) &&
              (x.detail === undefined || text(x.detail)),
          )
        )
          return null;
        break;
      case "steps":
        if (!items() || !data.items.every(text)) return null;
        break;
      case "graph": {
        if (
          !items("nodes", 24) ||
          !items("edges", 60) ||
          !data.nodes.every((x) => x && text(x.id) && text(x.label) && (x.role === undefined || text(x.role)))
        )
          return null;
        const ids = new Set(data.nodes.map((x) => x.id));
        if (
          ids.size !== data.nodes.length ||
          !data.edges.every(
            (x) =>
              x &&
              ids.has(x.from) &&
              ids.has(x.to) &&
              (x.label === undefined || text(x.label)),
          )
        )
          return null;
        break;
      }
      case "files":
        if (
          !items("paths", 100) ||
          !data.paths.every(
            (x) => text(x) && x.length <= 500 && x.split("/").length <= 12,
          )
        )
          return null;
        break;
      case "gallery":
        if (
          !items("images", 24) ||
          !data.images.every((x) => x && text(x.alt) && safeMedia(x.src)) ||
          (data.view !== undefined && !['grid','carousel'].includes(data.view))
        )
          return null;
        break;
      case "image-compare":
        if (
          ![data.before, data.after].every(
            (x) => x && safeMedia(x.src) && text(x.alt),
          )
        )
          return null;
        break;
      case "code-compare":
        if (
          !text(data.before) ||
          !text(data.after) ||
          data.before.split("\n").length > 240 ||
          data.after.split("\n").length > 240
        )
          return null;
        break;
      case "receipt":
        if (
          (data.people !== undefined && (!Number.isInteger(data.people) || data.people < 1 || data.people > 100)) ||
          !items() ||
          !data.items.every(
            (x) =>
              x &&
              text(x.label) &&
              typeof x.amount === "number" &&
              (x.detail === undefined || text(x.detail)) &&
              Number.isFinite(x.amount) &&
              Math.abs(x.amount) <= 1e12,
          ) ||
          !/^[A-Z]{3}$/.test(data.currency)
        )
          return null;
        try {
          new Intl.NumberFormat("en", {
            style: "currency",
            currency: data.currency,
          });
        } catch {
          return null;
        }
        break;
      case "qr":
        if (!safeMedia(data.url) || data.url.length > 1800) return null;
        break;
      case "model":
        if (!safeMedia(data.src, "model") || !text(data.alt)) return null;
        break;
    }
    return data;
  } catch {
    return null;
  }
}

export function fileTree(paths) {
  const root = new Map();
  for (const path of paths) {
    let branch = root;
    for (const name of path.split("/").filter(Boolean)) {
      if (!branch.has(name)) branch.set(name, new Map());
      branch = branch.get(name);
    }
  }
  return root;
}

export function movePinned(ids, id, direction) {
  const index = ids.indexOf(id),
    next = index + direction;
  if (index < 0 || next < 0 || next >= ids.length) return ids;
  const result = [...ids];
  [result[index], result[next]] = [result[next], result[index]];
  return result;
}

export function stackedSeries(columns, rows, values, label) {
  if (values.length < 2 || values.length > 8 || rows.length > 100) return null;
  const series = values.map((index) => numberSeries(rows, index));
  if (
    series.some((x) => !x || x.numbers.some((n) => n < 0)) ||
    !series.every((x) => x.unit === series[0].unit) ||
    series[0].unit.endsWith("%")
  )
    return null;
  const points = rows.map((row, i) => ({
    label: row[label],
    values: series.map((x) => x.numbers[i]),
    original: values.map((index) => row[index]),
  }));
  const totals = points.map((p) => p.values.reduce((sum, n) => sum + n, 0));
  if (totals.some((n) => !Number.isFinite(n))) return null;
  return {
    points,
    max: Math.max(...totals) || 1,
    columns: values.map((index) => columns[index]),
  };
}


// Recognize only validated UI payloads in data fences; executable language fences stay code.
export function richPayload(source, language = '', request = '') {
  if (wantsSourceReply(request)) return null;
  if (!richLanguage(language)) return null;
  return parseRichUI(source, richPresentationFor(request));
}
function richLanguage(language) {
  return ['', 'json', 'application/json', 'vaelo-ui', 'ui', ...RICH_TYPES, ...Object.keys(RICH_ALIASES)].includes(language.toLowerCase());
}
export function pendingRichPayload(source, language = '', request = '') {
  if (wantsSourceReply(request) || !richLanguage(language)) return false;
  if (language === 'vaelo-ui') return true;
  const type = source.slice(0, 1000).match(/^\s*\{[\s\S]*?"(?:type|component)"\s*:\s*"([\w-]+)"/i)?.[1]?.toLowerCase();
  return !!type && (RICH_TYPES.has(type) || Object.hasOwn(RICH_ALIASES, type));
}
export function wantsSourceReply(request = '') {
  return /\b(?:raw (?:json|code)|json only|code only|(?:show|return|output|give) (?:(?:me|the|only|just) ){0,3}(?:json|source code)|(?:respond|reply|answer|return|output) (?:only )?(?:with|as|in) (?:(?:valid|raw|only) )?json|(?:example|sample) json|json schema)\b/i.test(request);
}
export function reorderAt(ids, id, target, after = false) {
  if (id === target || !ids.includes(id) || !ids.includes(target)) return ids;
  const next = ids.filter(value => value !== id);
  next.splice(next.indexOf(target) + (after ? 1 : 0), 0, id);
  return next.every((value, i) => value === ids[i]) ? ids : next;
}

// Some models draw a "bento" as an ASCII or box-drawing grid inside a plain
// fence. A two-or-three column grid of label and value is exactly an overview,
// so recover it as one instead of showing the drawing as code.
const GRID_BORDER = /^[\s+\-=_:|─━│┃┌┐└┘├┤┬┴┼═║╔╗╚╝╠╣╦╩╬]*$/;
export function gridOverview(source, language = '') {
  if (typeof source !== 'string' || source.length > 4000 || !['', 'text', 'txt', 'plain', 'plaintext', 'ascii'].includes(language.toLowerCase())) return null;
  const rows = source.split('\n')
    .filter((line) => /[|│┃║]/.test(line) && !GRID_BORDER.test(line))
    .map((line) => line.split(/[|│┃║]/).map((cell) => cell.replace(/\*\*|__/g, '').trim()))
    .map((cells) => cells.slice(cells[0] === '' ? 1 : 0, cells.at(-1) === '' ? -1 : undefined));
  const cleaned = rows.filter((cells) => cells.length >= 2 && cells.length <= 3 && cells[0] && cells[1]);
  if (cleaned.length < 2 || cleaned.length > 12 || cleaned.length !== rows.length) return null;
  const header = !/\d/.test(cleaned[0][1]) && cleaned.slice(1).every((cells) => /\d/.test(cells[1]));
  const body = header ? cleaned.slice(1) : cleaned;
  if (body.length < 2) return null;
  return {
    type: 'overview',
    items: body.map(([label, value, detail]) => ({ label, value, ...(detail && { detail }) })),
  };
}
// A directory tree drawn with ├── and └── is a file browser, not code.
const TREE_LINE = /^((?:[│| ]   |    )*)(?:├── |└── |\|-- |`-- |\+-- )(.+?)\s*$/;
const TREE_LANGUAGES = ['', 'text', 'txt', 'plain', 'plaintext', 'tree', 'ascii', 'bash', 'sh', 'shell', 'console', 'markdown', 'md'];
const finishTree = (entries) => {
  if (entries.length < 3 || entries.length > 100) return null;
  const parents = new Set(entries.flatMap((path) => path.split('/').slice(0, -1).map((_, i, all) => all.slice(0, i + 1).join('/'))));
  const paths = entries.filter((path) => !parents.has(path));
  return paths.length && paths.every((path) => path.length <= 500 && path.split('/').length <= 12) ? { type: 'files', paths } : null;
};
// Indented outlines, markdown bullets and plain path lists: "src/", "  app.js",
// "- `lib/` — helpers". Every entry must look like a path, so prose never passes.
const OUTLINE_LINE = /^(\s*)(?:[-*+]\s+)?`?([\w@.-][\w@.\/-]*)`?\/?(?:`)?(?:\s*(?:[—–:#]|\/\/|<-|←|-\s).*)?$/;
function outlineTree(source) {
  const lines = source.split('\n').filter((line) => line.trim());
  if (lines.length < 3) return null;
  const stack = [];
  const entries = [];
  const named = [];
  for (const line of lines) {
    const match = line.replace(/\t/g, '    ').match(OUTLINE_LINE);
    if (!match || /^\d+$/.test(match[2])) return null;
    const indent = match[1].length;
    while (stack.length && stack.at(-1).indent >= indent) stack.pop();
    const name = match[2].replace(/\/$/, '');
    stack.push({ indent, name });
    entries.push(stack.map((x) => x.name).join('/'));
    named.push({ name: match[2], parent: stack.length > 1 });
  }
  const parents = new Set(entries.flatMap((path) => path.split('/').slice(0, -1).map((_, i, all) => all.slice(0, i + 1).join('/'))));
  const pathLike = entries.every((path, i) => /[./]/.test(named[i].name) || parents.has(path) || /^[A-Z][A-Za-z]+$/.test(named[i].name));
  return pathLike && entries.some((path) => /[./]/.test(path)) ? finishTree(entries) : null;
}
export function treePaths(source, language = '') {
  if (typeof source !== 'string' || source.length > 6000 || !TREE_LANGUAGES.includes(language.toLowerCase())) return null;
  return boxTree(source) || outlineTree(source);
}
function boxTree(source) {
  const lines = source.split('\n').filter((line) => line.trim());
  const entries = [];
  const stack = [];
  let root = '';
  for (const [index, line] of lines.entries()) {
    const match = line.match(TREE_LINE);
    if (!match) {
      if (index === 0 && !/[│├└|]/.test(line)) { root = line.trim().replace(/\/$/, ''); continue; }
      return null;
    }
    const depth = match[1].length / 4;
    const name = match[2].replace(/\s+(?:#|\/\/|<-|←).*$/, '').replace(/\/$/, '').trim();
    if (!name || name.includes('/') || depth > stack.length) return null;
    stack.length = depth;
    stack.push(name);
    entries.push((root ? [root, ...stack] : [...stack]).join('/'));
  }
  return finishTree(entries);
}
export function wantsOverview(request = '') {
  return /\b(?:bento|overview cards?|summary cards?|cards? (?:view|layout)|dashboard)\b/i.test(request);
}
