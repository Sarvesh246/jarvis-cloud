import { median, percentile } from './metrics.js';

function hasReview(row) {
  return row.review?.answer_sha256===row.answer_sha256 &&
    ['human','independent_judge'].includes(row.review.method) &&
    ['correct','complete','grounded','constraints'].every(key=>typeof row.review[key]==='boolean');
}
const reviewed=row=>hasReview(row)&&['correct','complete','grounded','constraints'].every(key=>row.review[key]);
export function compareReports(before,after,{minimumSamples=30}={}) {
  const reasons=[];
  if(!before.case_set_sha256 || before.case_set_sha256!==after.case_set_sha256) reasons.push('case_set_mismatch');
  if(before.mode!==after.mode || before.environment!==after.environment) reasons.push('environment_or_mode_mismatch');
  if(!/^[a-f0-9]{40}$/.test(before.deployed_revision||'') || !/^[a-f0-9]{40}$/.test(after.deployed_revision||'')) reasons.push('deployment_revision_unverified');
  if(!/^[a-f0-9]{40}$/.test(before.backend_revision||'') || !/^[a-f0-9]{40}$/.test(after.backend_revision||'')) reasons.push('backend_revision_unverified');
  const keys=new Set([...(before.rows||[]),...(after.rows||[])].map(row=>row.capability||'unspecified'));
  const cohorts=[];
  for(const capability of keys) {
    const a=(before.rows||[]).filter(row=>(row.capability||'unspecified')===capability);
    const b=(after.rows||[]).filter(row=>(row.capability||'unspecified')===capability);
    const passed=rows=>rows.filter(row=>row.outcome==='complete'&&!row.degraded&&row.quality?.passed);
    const stats=rows=>({samples:rows.length,automated_pass_rate:rows.length?passed(rows).length/rows.length:0,
      independently_reviewed:rows.filter(hasReview).length,
      semantic_pass_rate:rows.length?rows.filter(reviewed).length/rows.length:0,
      useful_completion_median_ms:median(passed(rows).map(row=>row.total_ms)),
      useful_completion_p95_ms:percentile(passed(rows).map(row=>row.total_ms),.95)});
    const left=stats(a),right=stats(b),issues=[];
    if(a.length<minimumSamples||b.length<minimumSamples) issues.push('insufficient_samples');
    if(a.length!==b.length || a.map(row=>row.case).sort().join('|')!==b.map(row=>row.case).sort().join('|')) issues.push('unmatched_cases');
    if(right.automated_pass_rate<left.automated_pass_rate) issues.push('automated_quality_regression');
    if(right.semantic_pass_rate<left.semantic_pass_rate) issues.push('semantic_quality_regression');
    if(left.independently_reviewed<a.length || right.independently_reviewed<b.length) issues.push('semantic_review_incomplete');
    cohorts.push({capability,before:left,after:right,issues,
      speed_change_percent:left.useful_completion_median_ms&&right.useful_completion_median_ms!==null?
        (left.useful_completion_median_ms-right.useful_completion_median_ms)/left.useful_completion_median_ms*100:null});
  }
  return {schema:1,eligible:!reasons.length&&cohorts.length>0&&cohorts.every(row=>!row.issues.length),reasons,cohorts,
    caveat:'Matched descriptive comparison. This does not establish causation or statistical significance. Incomplete reviews or samples cannot approve a speed optimization.'};
}
