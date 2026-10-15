import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { digest, verifyObservation } from './verifier.js';

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

export function groupDisclosure(plan, members) {
  // No private costs or explanations cross this explicit serialization boundary.
  return {status:plan.status, option:plan.option ?? null, fairness:plan.fairness ?? null,
    participants:members.filter(m=>m.revealParticipation === true).map(m=>m.id),
    limitation:'The proposal itself can reveal availability; this is not a formal inference-privacy guarantee.'};
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

export function contradictionMap(claims) {
  const groups = new Map();
  for (const claim of claims) {
    if (!claim.entityId || !claim.field || !claim.source?.document || !claim.source?.location) throw new Error('Stable entity identity and source location required.');
    const key = JSON.stringify([claim.entityId,claim.field,claim.scope,claim.effectiveFrom]);
    if (!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(claim);
  }
  return [...groups.values()].filter(group => group.some(c=>!isDeepStrictEqual(c.value,group[0].value)))
    .map(group=>({entityId:group[0].entityId,field:group[0].field,status:'review-required',claims:structuredClone(group)}));
}

export function recordProcedure(trace, postconditions) {
  if (!trace.supervised || trace.status !== 'completed' || !postconditions.length || postconditions.some(c=>c.status!=='passed')) throw new Error('Only a supervised success with explicit passed checks can become a candidate.');
  if (trace.steps.some(s=>!s.tool || !s.resourceTemplate || !s.inputSchema)) throw new Error('Parameterizable steps required.');
  const procedure = {schemaVersion:1,sourceRun:trace.id,steps:structuredClone(trace.steps),postconditions:postconditions.map(({path,op,expected})=>({path,op,expected})),status:'candidate-needs-replay'};
  return {...procedure,digest:digest(procedure)};
}

export function prepareFailureRecipe(record) {
  if (record.consent !== true) throw new Error('Explicit publication consent required.');
  if (!record.environment || !record.reproduction || !record.observed || !record.expected) throw new Error('Reproduction and observations required.');
  const publicFields = ['tool','version','environment','reproduction','observed','expected','fix'];
  const publication = Object.fromEntries(publicFields.filter(k=>record[k]!==undefined).map(k=>[k,structuredClone(record[k])]));
  const text = JSON.stringify(publication);
  if (/[\w.+-]+@[\w.-]+\.[a-z]{2,}|Bearer\s+\S+|\bsk-[\w-]+|[A-Z]:\\Users\\/i.test(text)) throw new Error('Detected potentially sensitive content. Human review required.');
  return {status:'draft-needs-human-review',recipe:publication,digest:digest(publication),limitation:'Pattern checks are incomplete and do not establish anonymity.'};
}

export function effortBudget(entries, {limitMinutes, periodStart, periodEnd}) {
  if (!Number.isFinite(limitMinutes) || limitMinutes < 0) throw new Error('Explicit nonnegative budget required.');
  const start = Date.parse(periodStart), end = Date.parse(periodEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error('Valid budget period required.');
  const ids = new Set();
  let minutes = 0;
  const byKind = Object.create(null);
  for (const entry of entries) {
    if (!entry.id || ids.has(entry.id)) throw new Error('Effort entries need unique ids.');
    ids.add(entry.id);
    if (!Number.isFinite(entry.minutes) || entry.minutes < 0 || !Number.isFinite(Date.parse(entry.at))) throw new Error('Valid observed effort required.');
    if (Date.parse(entry.at) < start || Date.parse(entry.at) >= end) continue;
    minutes += entry.minutes;
    byKind[entry.kind] = (byKind[entry.kind] ?? 0) + entry.minutes;
  }
  return {minutes,byKind,limitMinutes,remainingMinutes:Math.max(0,limitMinutes-minutes),decision:minutes>limitMinutes?'narrow-or-pause-proposed':'within-budget',savings:'not-measured'};
}

export async function distinguish({hypotheses, cases, observe}) {
  if (hypotheses.length !== 2 || hypotheses.some(h=>typeof h.predict!=='function')) throw new Error('Two testable predictions required.');
  const useful = cases.find(input=>!isDeepStrictEqual(hypotheses[0].predict(input),hypotheses[1].predict(input)));
  if (useful === undefined) return {status:'unresolved',reason:'No supplied case distinguishes the hypotheses.'};
  const actual = await observe(structuredClone(useful));
  const predictions = hypotheses.map(h=>({id:h.id,prediction:h.predict(useful)}));
  return {status:'observed',input:useful,actual,predictions,supported:predictions.filter(p=>isDeepStrictEqual(p.prediction,actual)).map(p=>p.id),limitation:'Observation applies to this runtime and this case, not every possible input.'};
}
