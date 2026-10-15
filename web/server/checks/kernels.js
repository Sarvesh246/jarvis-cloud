// The pure kernels behind Workroom checks. Each takes plain data and
// returns plain data; check-engine.js validates inputs and shapes results.

const clone = value => structuredClone(value);
const requireCondition = (condition, message) => { if (!condition) throw new Error(message); };

/** A merchant promise cannot close a case; settlement must match the original stable order ID. */
export function evaluateConsumerCase(record, observations, now) {
  const seen = new Set();
  const matches = observations.filter(item => {
    const key = item.transactionId ?? item.source;
    if (!key || !item.source || seen.has(key) || !Number.isSafeInteger(item.amountCents) || item.amountCents <= 0 || item.orderId !== record.orderId || item.currency !== record.currency || item.status !== 'settled') return false;
    seen.add(key); return true;
  });
  const settledCents = matches.reduce((sum, item) => sum + item.amountCents, 0);
  const status = settledCents >= record.expectedCents ? 'resolved' : settledCents > 0 ? 'partial' : 'unresolved';
  return { caseId: record.id, status, settledCents, outstandingCents: Math.max(0, record.expectedCents - settledCents),
    followupDue: status !== 'resolved' && Date.parse(now) >= Date.parse(record.followupAt),
    evidence: matches.map(item => item.source), nextAction: status === 'resolved' ? 'archive evidence' : 'draft authorized follow-up for review' };
}

/** Pure reducer keeps stable field identities, validation recovery, and an explicit review gate. */
export function transitionForm(state, event, schema) {
  const next = clone(state);
  if (event.type === 'edit') {
    requireCondition(schema.some(field => field.id === event.id), 'Unknown field');
    next.values[event.id] = event.value;
    delete next.errors[event.id];
    next.reviewed = false;
  } else if (event.type === 'review') {
    next.errors = Object.fromEntries(schema.filter(field => field.required && !String(next.values[field.id] ?? '').trim()).map(field => [field.id, `${field.label} is required`]));
    next.focus = Object.keys(next.errors)[0] ?? 'review-heading';
    next.reviewed = Object.keys(next.errors).length === 0;
    next.announcement = next.reviewed ? 'Review your answers before submitting.' : `${Object.keys(next.errors).length} fields need correction.`;
  } else if (event.type === 'submit') {
    requireCondition(next.reviewed && Object.keys(next.errors).length === 0, 'Review required');
    next.status = 'ready-for-authorized-submission';
  } else throw new Error('Unknown form event');
  return next;
}


// Exhaustive search is intentionally bounded. Unknown/too-large is not infeasible.
export function choosePlan(members, options, {fairness, maxOptions = 100} = {}) {
  if (!['total', 'worst-member'].includes(fairness)) throw new Error('Participants must choose a fairness rule.');
  if (!members.length || new Set(members.map(m => m.id)).size !== members.length) throw new Error('Unique members required.');
  if (options.length > maxOptions) return {status:'unknown', reason:'Search bound exceeded.'};
  const feasible = options.filter(option => members.every(m => m.acceptable.includes(option)));
  const ranked = feasible.map(option => {
    const burdens = members.map(m => {
      const cost = m.costs[option];
      const prior = m.priorBurden ?? 0;
      if (![cost, prior].every(x => Number.isFinite(x) && x >= 0)) throw new Error('Explicit nonnegative burdens required.');
      return {id:m.id, added:cost, total:prior + cost};
    });
    return {option, burdens, score:fairness === 'total' ? burdens.reduce((s,b)=>s+b.total,0) : Math.max(...burdens.map(b=>b.total))};
  }).sort((a,b)=>a.score-b.score || a.option.localeCompare(b.option));
  if (!ranked.length) return {status:'infeasible', reason:'No option is acceptable to all members.'};
  return {status:'proposed', option:ranked[0].option, fairness, privateBurdenLedger:ranked[0].burdens, alternatives:ranked.slice(1).map(x=>x.option)};
}


export function permittedRelaxations(options, constraints, maxRelaxed = 2) {
  if (constraints.some(c=>typeof c.id!=='string' || !c.id.trim()) || new Set(constraints.map(c=>c.id)).size!==constraints.length) throw new Error('Constraints require unique ids.');
  if (constraints.length > 12 || options.length > 100 || maxRelaxed > 4) return {status:'unknown', proposals:[]};
  const satisfies = (option, constraint) => constraint.allowed.includes(option);
  const initial = options.filter(o=>constraints.every(c=>satisfies(o,c)));
  if (initial.length) return {status:'feasible', options:initial, proposals:[]};
  const permitted = constraints.filter(c=>c.mayRelax === true);
  for (let size=1; size<=Math.min(maxRelaxed,permitted.length); size++) {
    const proposals = [];
    const visit = (start, chosen) => {
      if (chosen.length === size) {
        const dropped = new Set(chosen.map(c=>c.id));
        const choices = options.filter(o=>constraints.filter(c=>!dropped.has(c.id)).every(c=>satisfies(o,c)));
        if (choices.length) proposals.push({relax:[...dropped],options:choices});
        return;
      }
      for (let i=start;i<permitted.length;i++) visit(i+1,[...chosen,permitted[i]]);
    };
    visit(0,[]);
    if (proposals.length) return {status:'relaxation-proposed',cardinality:size,proposals};
  }
  return {status:'no-permitted-repair-within-bound', proposals:[]};
}



