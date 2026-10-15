/* Hermes keeps a plan for multi-step work (its todo_list tool) and returns
   the whole list after every write: [{id, content, status, parent?}] with a
   revision that only moves forward. Only those four fields are kept, so
   nothing else a tool was given ever reaches the page. */

export const PLAN_LIMITS = { items: 40, chars: 400 };

const STATES = new Set(["pending", "in_progress", "completed", "cancelled"]);
const FINISHED = new Set(["completed", "cancelled"]);

export const isFinished = (item) => FINISHED.has(item.status);

/* The plan from a `hermes.todo` event (or a tool result carrying the same
   shape, as a JSON string or object). Null when there is nothing usable. */
export function readPlan(data) {
  let source = data;
  if (typeof source === "string") {
    try {
      source = JSON.parse(source);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(source?.todos)) return null;
  const seen = new Set();
  const items = [];
  for (const raw of source.todos) {
    if (!raw || typeof raw !== "object") continue;
    const id = String(raw.id ?? "").trim().slice(0, 80);
    const content = typeof raw.content === "string" ? raw.content.replace(/\s+/g, " ").trim() : "";
    if (!id || !content || seen.has(id)) continue;
    seen.add(id);
    const status = String(raw.status || "").toLowerCase();
    const parent = typeof raw.parent === "string" ? raw.parent.trim() : "";
    items.push({
      id,
      content: content.length > PLAN_LIMITS.chars ? `${content.slice(0, PLAN_LIMITS.chars - 1)}…` : content,
      status: STATES.has(status) ? status : "pending",
      ...(parent && parent !== id && { parent }),
    });
    if (items.length >= PLAN_LIMITS.items) break;
  }
  const revision = Number.isFinite(source.revision) ? source.revision : undefined;
  return { items, ...(revision !== undefined && { revision }) };
}

/* Fold a newer list into the one already on the reply. A list from an older
   revision is ignored; each item remembers when it was finished so finished
   items settle at the bottom in the order they were done. */
export function mergePlan(previous, next, now = Date.now()) {
  if (!next) return previous ?? null;
  if (previous?.revision !== undefined && next.revision !== undefined && next.revision < previous.revision)
    return previous;
  const before = new Map((previous?.items || []).map((item) => [item.id, item]));
  const items = next.items.map((item) => {
    const old = before.get(item.id);
    if (!isFinished(item)) return item;
    return { ...item, doneAt: old && isFinished(old) && old.doneAt ? old.doneAt : now };
  });
  return { items, ...(next.revision !== undefined && { revision: next.revision }), updatedAt: now };
}

/* Open items first, in Hermes's priority order; finished ones beneath, oldest
   first. A nested plan keeps its authored order, since moving a subtask would
   tear it from its parent. */
export function orderPlan(items = []) {
  if (items.some((item) => item.parent)) return items;
  const open = items.filter((item) => !isFinished(item));
  const done = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => isFinished(item))
    .sort((a, b) => (a.item.doneAt ?? 0) - (b.item.doneAt ?? 0) || a.index - b.index)
    .map(({ item }) => item);
  return [...open, ...done];
}

export function planSummary(items = []) {
  const done = items.filter((item) => item.status === "completed").length;
  return `${done} of ${items.length} done`;
}
