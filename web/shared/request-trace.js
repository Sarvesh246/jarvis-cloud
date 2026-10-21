// Content-free process-local timings. Correlate by run ID; never subtract
// timestamps from separate machines. No extra network or model request.
export function requestTrace(run, layer, { clock = () => performance.now(), report = () => {} } = {}) {
  const began = clock();
  const spans = {}, marks = {};
  let ended = false;
  const elapsed = () => Math.max(0, Math.round(clock() - began));
  return {
    identify(id) { run = id; },
    mark(name) { if (!(name in marks)) marks[name] = elapsed(); },
    async span(name, work) {
      const start = clock();
      try { return await work(); }
      finally { spans[name] = Math.max(0, Math.round(clock() - start)); }
    },
    finish(outcome) {
      if (ended) return;
      ended = true;
      const record = { schema: 1, kind: "vaelo.trace", run, layer, outcome,
        total_ms: elapsed(), spans_ms: { ...spans }, marks_ms: { ...marks } };
      try { report(record); } catch { /* Diagnostics cannot fail a reply. */ }
      return record;
    },
  };
}
