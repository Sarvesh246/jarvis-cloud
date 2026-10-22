import { createHash } from 'node:crypto';

// Export reviewed synthetic examples only. This never starts a training job,
// contacts a provider or promotes generated answers to ground truth by itself.
export function reviewedExamples(report,cases) {
  const examples=[],skipped=[];
  const known=new Map(cases.map(item=>[item.id,item]));
  for(const row of report.rows||[]) {
    const item=known.get(row.case),answer=row.answer_for_review,review=row.review;
    const acceptable=item&&typeof answer==='string'&&answer.length===row.answer_chars&&
      createHash('sha256').update(answer).digest('hex')===row.answer_sha256&&
      review?.answer_sha256===row.answer_sha256&&['human','independent_judge'].includes(review.method)&&
      ['correct','complete','grounded','constraints'].every(key=>review[key]===true)&&
      row.outcome==='complete'&&!row.degraded&&row.quality?.passed;
    if(!acceptable) {skipped.push(row.case);continue;}
    examples.push({messages:[...item.messages,{role:'assistant',content:answer}]});
  }
  return {examples,skipped};
}
