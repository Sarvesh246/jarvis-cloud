import { numberSeries } from "./intelligent-ui.js";
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
]);
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
export function parseRichUI(source) {
  if (typeof source !== "string" || source.length > 60000) return null;
  try {
    const data = JSON.parse(source);
    if (!data || Array.isArray(data) || !RICH_TYPES.has(data.type)) return null;
    const text = (v) => typeof v === "string" && v.length <= 8000;
    const items = (key = "items", max = 40) =>
      Array.isArray(data[key]) &&
      data[key].length > 0 &&
      data[key].length <= max;
    if (data.title !== undefined && !text(data.title)) return null;
    switch (data.type) {
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
          !data.nodes.every((x) => x && text(x.id) && text(x.label))
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
          !data.images.every((x) => x && text(x.alt) && safeMedia(x.src))
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
          !items() ||
          !data.items.every(
            (x) =>
              x &&
              text(x.label) &&
              typeof x.amount === "number" &&
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
    max: Math.max(1, ...totals),
    columns: values.map((index) => columns[index]),
  };
}
