export function percentile(values, p) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] : null;
}

export function checkAnswer(answer, checks = {}) {
  const text = answer.trim();
  const checksRun = [];
  if (checks.exact) checksRun.push(text.replace(/[.!]$/, '') === checks.exact);
  if (checks.maxChars) checksRun.push(text.length <= checks.maxChars);
  for (const value of checks.includes || []) checksRun.push(text.toLowerCase().includes(value.toLowerCase()));
  if (checks.any) checksRun.push(checks.any.some(value => text.toLowerCase().includes(value.toLowerCase())));
  if (checks.source) checksRun.push(/https:\/\/[^\s)]+/.test(text));
  return { passed: Boolean(text) && checksRun.every(Boolean), checks: checksRun.length,
    semanticReview: 'unverified' };
}

export function summarize(rows) {
  const complete = rows.filter(row => row.outcome === 'complete');
  const stats = key => ({ n: complete.filter(row => Number.isFinite(row[key])).length,
    median_ms: percentile(complete.map(row => row[key]), .5), p95_ms: percentile(complete.map(row => row[key]), .95) });
  return { samples: rows.length, completed: complete.length,
    failures: rows.length - complete.length,
    automated_passes: complete.filter(row => row.quality?.passed).length,
    first_answer: stats('first_answer_ms'), total: stats('total_ms'),
    failure_latency: { n: rows.length - complete.length, p95_ms: percentile(rows.filter(row => row.outcome !== 'complete').map(row => row.total_ms), .95) },
    semantic_quality: 'unverified', rendering: 'unverified',
    caveat: 'Small samples are descriptive, not an SLO. Latency percentiles include completed requests only; failures are reported separately. Compare like capability, mode, and environment.' };
}
