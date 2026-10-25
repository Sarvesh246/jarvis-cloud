export function percentile(values, p) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] : null;
}

export function checkAnswer(answer, checks = {}) {
  const text = answer.trim();
  // Typography varies by provider; straight and curly apostrophes must not
  // turn an honest "I can’t determine that" into a false failure.
  const folded = text.toLowerCase().replace(/[‘’]/g, "'");
  const fold = value => value.toLowerCase().replace(/[‘’]/g, "'");
  const checksRun = [];
  if (checks.exact !== undefined) checksRun.push(text === checks.exact);
  if (checks.maxChars) checksRun.push(text.length <= checks.maxChars);
  for (const value of checks.includes || []) checksRun.push(folded.includes(fold(value)));
  if (checks.any) checksRun.push(checks.any.some(value => folded.includes(fold(value))));
  if (checks.source) checksRun.push(/https:\/\/[^\s)]+/.test(text));
  if (checks.maxWords !== undefined) checksRun.push(text.split(/\s+/u).filter(Boolean).length<=checks.maxWords);
  if (checks.exactLines !== undefined) checksRun.push(text.split(/\r?\n/).length===checks.exactLines);
  if (checks.sentences !== undefined) checksRun.push(text.split(/(?<=[.!?。！？])\s+(?=[\p{L}\p{N}"“])/u).filter(Boolean).length===checks.sentences);
  for (const value of checks.forbidden || []) checksRun.push(!folded.includes(fold(value)));
  if (checks.json !== undefined || checks.jsonEquals !== undefined || checks.requiredKeys) {
    try {
      const value=JSON.parse(text);
      checksRun.push(true);
      if(checks.jsonEquals!==undefined) checksRun.push(equalJSON(value,checks.jsonEquals));
      if(checks.requiredKeys) checksRun.push(value!==null&&typeof value==='object'&&!Array.isArray(value)&&
        checks.requiredKeys.every(key=>Object.hasOwn(value,key)));
    } catch { checksRun.push(false); }
  }
  return { passed: Boolean(text) && checksRun.length > 0 && checksRun.every(Boolean), checks: checksRun.length,
    semanticReview: 'unverified' };
}

function equalJSON(left,right) {
  if(left===right) return true;
  if(!left||!right||typeof left!=='object'||typeof right!=='object'||Array.isArray(left)!==Array.isArray(right)) return false;
  const keys=Object.keys(left);
  return keys.length===Object.keys(right).length&&keys.every(key=>Object.hasOwn(right,key)&&equalJSON(left[key],right[key]));
}

export function median(values) {
  const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);
  const middle=Math.floor(sorted.length/2);
  return sorted.length?sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2:null;
}

export function summarize(rows, breakdown = true) {
  const complete = rows.filter(row => row.outcome === 'complete');
  const stats = key => ({ n: complete.filter(row => Number.isFinite(row[key])).length,
    median_ms: median(complete.map(row => row[key])), p95_ms: percentile(complete.map(row => row[key]), .95),
    p99_ms: percentile(complete.map(row => row[key]), .99) });
  return { samples: rows.length, completed: complete.length,
    failures: rows.length - complete.length,
    degraded: complete.filter(row => row.degraded).length,
    automated_passes: complete.filter(row => !row.degraded && row.quality?.passed).length,
    first_answer: stats('first_answer_ms'), total: stats('total_ms'),
    failure_latency: { n: rows.length - complete.length, p95_ms: percentile(rows.filter(row => row.outcome !== 'complete').map(row => row.total_ms), .95) },
    semantic_quality: 'unverified', rendering: 'unverified',
    ...(breakdown&&{cohorts:Object.fromEntries([...new Set(rows.map(row=>row.capability||'unspecified'))]
      .map(capability=>[capability,summarize(rows.filter(row=>(row.capability||'unspecified')===capability),false)]))}),
    caveat: 'Small samples are descriptive, not an SLO. Latency percentiles include completed requests only; failures are reported separately. Compare like capability, mode, and environment.' };
}
