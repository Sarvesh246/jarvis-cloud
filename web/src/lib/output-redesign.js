// Derived presentation only. No invented completion states or metric rankings.
import { numberSeries } from "./intelligent-ui.js";

// A narrow, deterministic fallback over facts in the user's own request.
// It never derives links from a model's analogy or guesses cache behavior.
export function explicitRelationshipGraph(request = "") {
  if (
    request.length > 12000 ||
    /\b(?:if|unless|suppose|assuming)\b/i.test(request)
  )
    return null;
  const nodes = [],
    edges = [],
    ids = new Map();
  const entity = (text) => text.replace(/^(?:our|my|the|an?)\s+/i, "").trim();
  const valid = (text) =>
    /^[\p{L}\p{N}_][\p{L}\p{N}_ +.\/-]{0,59}$/u.test(text) &&
    text.split(/\s+/).length <= 5;
  const node = (label) => {
    const key = label.toLowerCase();
    if (!ids.has(key)) {
      ids.set(key, "n" + nodes.length);
      nodes.push({
        id: ids.get(key),
        label: label[0].toUpperCase() + label.slice(1),
      });
    }
    return ids.get(key);
  };
  let subject = "",
    previousObject = "";
  const verbs =
    "(calls|reads|checks|queries|writes to|sends to|connects to|depends on)";
  for (const fragment of request.split(/(?<=[.!?;])\s+|,\s*|\s+and\s+/)) {
    if (fragment.includes("?")) continue;
    const clause = fragment.trim().replace(/[.!?]+$/, "");
    if (
      /\b(?:not|never|if|might|may|could|would|should|does|do|how|whether)\b/i.test(
        clause,
      )
    )
      continue;
    const relative = clause.match(
      new RegExp("^(?:which|it)\\s+" + verbs + "\\s+(.+)$", "i"),
    );
    const bare = clause.match(new RegExp("^" + verbs + "\\s+(.+)$", "i"));
    const full = clause.match(
      new RegExp("^(.+?)\\s+" + verbs + "\\s+(.+)$", "i"),
    );
    let verb, target, nextSubject;
    if (relative) {
      nextSubject = previousObject;
      verb = relative[1];
      target = relative[2];
    } else if (bare) {
      nextSubject = subject;
      verb = bare[1];
      target = bare[2];
    } else if (full) {
      nextSubject = entity(full[1]);
      verb = full[2];
      target = full[3];
    } else continue;
    target = entity(target);
    if (!valid(nextSubject) || !valid(target)) continue;
    subject = nextSubject;
    previousObject = target;
    const from = node(subject),
      to = node(target);
    if (
      from !== to &&
      !edges.some(
        (e) =>
          e.from === from &&
          e.to === to &&
          e.label.toLowerCase() === verb.toLowerCase(),
      )
    )
      edges.push({
        from,
        to,
        label: verb[0].toUpperCase() + verb.slice(1).toLowerCase(),
      });
    if (nodes.length > 24 || edges.length > 40) return null;
  }
  return edges.length && nodes.length >= 2
    ? { type: "graph", title: "Service relationships", nodes, edges }
    : null;
}

export function barScale(max) {
  if (!(max > 0) || !Number.isFinite(max)) return 1;
  const step = 10 ** Math.floor(Math.log10(max)) / 2;
  const scaled = Math.ceil(max / step) * step;
  return Number.isFinite(scaled) && scaled >= max ? scaled : max;
}

export function smoothChartPath(points) {
  const coords = points.split(" ").map((pair) => pair.split(",").map(Number));
  if (
    !coords.length ||
    coords.some((p) => p.length !== 2 || !p.every(Number.isFinite))
  )
    return "";
  const slopes = coords
    .slice(1)
    .map(([x, y], i) => (y - coords[i][1]) / (x - coords[i][0]));
  const tangent = coords.map((_, i) => {
    if (!i) return slopes[0] || 0;
    if (i === coords.length - 1) return slopes[i - 1] || 0;
    const a = slopes[i - 1],
      b = slopes[i];
    return !a || !b || Math.sign(a) !== Math.sign(b) ? 0 : 2 / (1 / a + 1 / b);
  });
  return coords.reduce((path, [x, y], i) => {
    if (!i) return `M ${x} ${y}`;
    const [px, py] = coords[i - 1],
      dx = (x - px) / 3;
    return `${path} C ${px + dx} ${py + dx * tangent[i - 1]}, ${x - dx} ${y - dx * tangent[i]}, ${x} ${y}`;
  }, "");
}

export function percentageShares(values) {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (
    !(total > 0) ||
    values.some((value) => !Number.isFinite(value) || value < 0)
  )
    return null;
  const raw = values.map((value) => (value / total) * 100),
    result = raw.map(Math.floor);
  const order = raw
    .map((value, i) => ({ i, remainder: value - result[i] }))
    .sort((a, b) => b.remainder - a.remainder);
  for (
    let i = 0, remaining = 100 - result.reduce((sum, value) => sum + value, 0);
    i < remaining;
    i++
  )
    result[order[i].i]++;
  return result;
}
export function bestTableCells(columns, rows, indices) {
  const result = new Set();
  if (indices.length < 2) return result;
  columns.forEach((name, column) => {
    // "Best" is meaningful only for an explicit measure with an unambiguous direction.
    const low = /\b(?:price|cost|weight|latency|errors?|refund rate)\b/i.test(
      name,
    );
    const high = /\b(?:score|rating|battery|throughput)\b/i.test(name);
    if (!low && !high) return;
    let series = numberSeries(
      indices.map((i) => rows[i]),
      column,
    );
    if (!series) {
      const values = indices.map((i) =>
        String(rows[i][column])
          .trim()
          .match(/^([+-]?\d+(?:\.\d+)?)\s*(h|hours?|kg|g|lb|lbs|ms|s)$/i),
      );
      if (
        values.every(Boolean) &&
        new Set(
          values.map((value) =>
            value[2].toLowerCase().replace(/^hours?$/, "h"),
          ),
        ).size === 1
      )
        series = { numbers: values.map((value) => Number(value[1])) };
    }
    if (!series) return;
    const best = (low ? Math.min : Math.max)(...series.numbers);
    series.numbers.forEach((value, i) => {
      if (value === best) result.add(`${indices[i]}:${column}`);
    });
  });
  return result;
}
export function timelineDate(label) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(label)) return null;
  const date = new Date(`${label}T12:00:00`);
  return Number.isFinite(date.getTime()) &&
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}` ===
      label
    ? date
    : null;
}
export function timelineLayout(events, now = new Date()) {
  const dates = events.map((event) => timelineDate(event.when));
  const known = dates.filter(Boolean);
  const first = known.length ? Math.min(...known.map(Number)) : null,
    last = known.length ? Math.max(...known.map(Number)) : null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  const years = new Set(known.map((date) => date.getFullYear()));
  return {
    today:
      first !== null && last > first && today >= first && today <= last
        ? ((today - first) / (last - first)) * 100
        : null,
    events: events.map((event, i) => {
      const date = dates[i];
      const days = date ? Math.round((date - today) / 86400000) : null;
      const explicit = event.what.match(/^\[(done|current|upcoming)\]\s*/i);
      return {
        ...event,
        displayDate: date
          ? new Intl.DateTimeFormat(undefined, {
              month: "short",
              day: "numeric",
              ...(years.size > 1 ? { year: "numeric" } : {}),
            }).format(date)
          : event.when,
        what: explicit ? event.what.slice(explicit[0].length) : event.what,
        status: explicit
          ? explicit[1].toLowerCase()
          : days === null
            ? null
            : days < 0
              ? "past"
              : days === 0
                ? "current"
                : "upcoming",
        relative:
          days === null
            ? ""
            : new Intl.RelativeTimeFormat(undefined, {
                numeric: "auto",
              }).format(
                Math.abs(days) >= 14 ? Math.round(days / 7) : days,
                Math.abs(days) >= 14 ? "week" : "day",
              ),
        duration:
          date && dates[i + 1] > date
            ? Math.max(1, Math.min(365, (dates[i + 1] - date) / 86400000))
            : 1,
      };
    }),
  };
}
