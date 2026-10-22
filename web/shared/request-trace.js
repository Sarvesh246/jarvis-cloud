/* Content-free timings. Use one monotonic clock per process; never subtract
   timestamps from different machines. No telemetry request is made. */
export function requestTrace(run, layer, { clock = () => performance.now(), report = () => {} } = {}) {
  const began = clock();
  const spans = {}, marks = {}, counts = {};
  let ended = false;
  const elapsed = () => Math.max(0, Math.round(clock() - began));
  return {
    identify(id) { run = id; },
    mark(name) { if (!(name in marks)) marks[name] = elapsed(); },
    count(name) { counts[name] = (counts[name] || 0) + 1; },
    async span(name, work) {
      const start = clock();
      try { return await work(); }
      finally { spans[name] = (spans[name] || 0) + Math.max(0, Math.round(clock() - start)); }
    },
    finish(outcome) {
      if (ended) return;
      ended = true;
      const record = { schema: 1, kind: 'vaelo.trace', run, layer, outcome, total_ms: elapsed(), spans_ms: { ...spans }, marks_ms: { ...marks }, counts: { ...counts } };
      try { report(record); } catch { /* Diagnostics cannot fail a reply. */ }
      return record;
    },
  };
}
