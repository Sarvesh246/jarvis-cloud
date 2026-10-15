import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { isDeepStrictEqual } from 'node:util';




const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const day = 86400000;
const date = value => { const n = Date.parse(value); if (!Number.isFinite(n)) throw new Error('Valid date required'); return n; };

// Deliberately scores only recorded attempts, never inferred learning or engagement.
export function assessTransfer({ baseline, practice, delayed, minimumDelayHours = 24 }) {
  const seen = new Set([...baseline, ...practice].map(a => a.task));
  const start = Math.max(...practice.map(a => date(a.at)));
  const counted = new Set();
  const eligible = delayed.filter(a => {
    if (counted.has(a.task) || seen.has(a.task) || a.assistance !== 0 || date(a.at) - start < minimumDelayHours * 3600000 || !Number.isFinite(start)) return false;
    counted.add(a.task); return true;
  });
  const score = attempts => attempts.length ? attempts.filter(a => a.correct === true).length / attempts.length : null;
  const base = score(baseline.filter(a => a.assistance === 0));
  const transfer = score(eligible);
  return { status: base !== null && eligible.length >= 2 ? 'assessed' : 'insufficient-evidence', baseline: base,
    delayed: transfer, gain: base === null || transfer === null ? null : transfer - base,
    eligibleTasks: eligible.map(a => a.task), excluded: delayed.length - eligible.length,
    interpretation: 'Recorded assessment; no causal learning effect established.' };
}

export function rankPurchases(items, constraints) {
  const evaluated = items.map(item => {
    const unmet = [];
    if (!Number.isFinite(item.price) || !Number.isFinite(item.annualCost)) unmet.push('unknown-total-cost');
    const total = item.price + item.annualCost * constraints.years;
    if (total > constraints.budget) unmet.push('budget');
    if (constraints.excludeCommercial && item.commercialRelationship !== 'none') unmet.push('commercial-relationship');
    for (const [key, required] of Object.entries(constraints.requires)) if (item.specs?.[key] !== required) unmet.push(key);
    if (!item.verifiedAt || date(constraints.asOf) - date(item.verifiedAt) > 30 * day) unmet.push('stale-specifications');
    return { id: item.id, total, unmet, relationship: item.commercialRelationship };
  });
  return { eligible: evaluated.filter(i => !i.unmet.length).sort((a,b) => a.total-b.total || a.id.localeCompare(b.id)), excluded: evaluated.filter(i => i.unmet.length) };
}

export function researchChanges(previous, next, { asOf, seen = [] }) {
  const alerts = [];
  const prior = new Map(previous.map(c => [c.id, c]));
  const currentIds = new Set(next.map(c => c.id));
  for (const old of previous) if (!currentIds.has(old.id)) {
    const key = hash({ id: old.id, sourceVersion: old.sourceVersion, reason: 'evidence-removed' });
    if (!seen.includes(key)) alerts.push({ key, claim: old.id, reasons: ['evidence-removed'], action: 'Recheck the linked claim; the supplied new source set no longer includes its evidence.' });
  }
  for (const claim of next) {
    const old = prior.get(claim.id);
    const reasons = [];
    if (!old || old.finding !== claim.finding || Boolean(old.retracted) !== Boolean(claim.retracted)) reasons.push('evidence-changed');
    if (date(asOf) >= date(claim.expiresAt)) reasons.push('evidence-expired');
    if (!reasons.length) continue;
    const key = hash({ id: claim.id, sourceVersion: claim.sourceVersion, finding: claim.finding, retracted: claim.retracted ?? false, expiresAt: claim.expiresAt, reasons });
    if (!seen.includes(key)) alerts.push({ key, claim: claim.id, reasons, action: 'Recheck the linked claim; do not rewrite automatically.' });
  }
  return alerts;
}

export function policyChanges(before, after, useCase, { asOf, seen = [] }) {
  const alerts = [];
  for (const field of useCase.watchFields) {
    if (isDeepStrictEqual(before.terms[field], after.terms[field])) continue;
    const key = hash({ policy: after.id, field, value: after.terms[field], effectiveAt: after.effectiveAt });
    if (!seen.includes(key)) alerts.push({ key, field, before: before.terms[field] ?? null, after: after.terms[field] ?? null,
      beforePresent: Object.hasOwn(before.terms, field), afterPresent: Object.hasOwn(after.terms, field),
      status: date(after.effectiveAt) <= date(asOf) ? 'effective-change' : 'upcoming-change', effectiveAt: after.effectiveAt, sourceVersion: after.version });
  }
  return alerts;
}

export function reassessDecision(decision, observations, asOf) {
  const reasons = [];
  if (date(asOf) >= date(decision.reviewAt)) reasons.push('scheduled-review');
  for (const evidence of decision.evidence) if (date(asOf) >= date(evidence.expiresAt)) reasons.push(`expired:${evidence.id}`);
  for (const assumption of decision.assumptions) {
    const observed = observations[assumption.key];
    if (observed === undefined) { reasons.push(`unknown:${assumption.key}`); continue; }
    const changed = typeof assumption.value === 'number' ? !Number.isFinite(observed) || Math.abs(observed-assumption.value) > (assumption.tolerance ?? 0) : !isDeepStrictEqual(observed, assumption.value);
    if (changed) reasons.push(`changed:${assumption.key}`);
  }
  return { decision: decision.id, status: reasons.length ? 'review-needed' : 'keep-monitoring', reasons,
    action: reasons.length ? 'Review evidence and alternatives; original decision is retained.' : 'No notification', key: hash({ id: decision.id, reasons, observations }) };
}

export function correctVocabulary(text, records, scope) {
  if (!['user','occupation','languagePair'].every(k => typeof scope[k] === 'string' && scope[k].length > 0)) throw new Error('Complete correction scope required');
  const applicable = records.filter(r => r.confirmed === true && r.revoked !== true && ['user','occupation','languagePair'].every(k => r[k] === scope[k]));
  const corrections = [];
  // Exact token sequences only. Ambiguous confirmed mappings are not applied.
  const mappings = new Map();
  for (const r of applicable) mappings.set(r.heard, new Set([...(mappings.get(r.heard) ?? []), r.intended]));
  const words = [...mappings].filter(([heard, choices]) => heard.trim() && choices.size === 1).map(([heard]) => heard).sort((a,b)=>b.length-a.length);
  const alternatives = words.map(heard => heard.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alternatives})(?![\\p{L}\\p{N}_])`, 'gu');
  const result = !words.length ? text : text.replace(pattern, heard => {
    const intended = [...mappings.get(heard)][0]; corrections.push({ heard, intended }); return intended;
  });
  return { original: text, text: result, corrections, boundary: 'Transcript vocabulary correction only; no accent or acoustic model trained.' };
}

export function routeByOutcome(models, task, policy) {
  const candidates = [], excluded = [];
  for (const model of models) {
    const reasons = [];
    const sample = model.outcomes[task] ?? [];
    if (![model.cost, model.verificationCost, model.latencyMs, model.verificationLatencyMs, model.retentionDays].every(n => Number.isFinite(n) && n >= 0)) reasons.push('unknown-cost-latency-or-retention');
    if (!sample.every(x => typeof x === 'boolean')) reasons.push('invalid-outcomes');
    if (policy.localOnly && model.location !== 'local') reasons.push('privacy');
    if (model.retentionDays > policy.maxRetentionDays) reasons.push('retention');
    if (sample.length < policy.minimumSamples) reasons.push('insufficient-results');
    const cost = model.cost + model.verificationCost;
    if (cost > policy.maxCost) reasons.push('budget');
    if (model.latencyMs + model.verificationLatencyMs > policy.maxLatencyMs) reasons.push('latency');
    const successes = sample.filter(x => x === true).length;
    const observedSuccess = sample.length ? successes/sample.length : 0;
    if (observedSuccess < policy.minimumSuccess) reasons.push('quality');
    if (reasons.length) { excluded.push({ id: model.id, reasons }); continue; }
    candidates.push({ id: model.id, samples: sample.length, observedSuccess, costWithVerification: cost, costPerObservedSuccess: cost/observedSuccess });
  }
  candidates.sort((a,b) => a.costPerObservedSuccess-b.costPerObservedSuccess || a.id.localeCompare(b.id));
  return { status: candidates.length ? 'routed' : 'no-eligible-model', selected: candidates[0]?.id ?? null, candidates, excluded,
    boundary: 'Supplied outcome samples are not independently verified provider quality or a forecast.' };
}

export function labelClaim(claim, asOf) {
  if (!claim.evidence?.length) return 'unverified';
  const fresh = claim.evidence.filter(e => date(e.expiresAt) > date(asOf));
  if (!fresh.length) return 'stale';
  if (fresh.some(e => e.verdict === 'supports') && fresh.some(e => e.verdict === 'contradicts')) return 'disputed';
  if (fresh.some(e => e.verdict === 'contradicts')) return 'disputed';
  return fresh.some(e => e.verdict === 'supports') ? 'supported' : 'unverified';
}

export function nextCheck(claim, checks, constraints, asOf) {
  const label = labelClaim(claim, asOf);
  const eligible = checks.filter(c => c.claim === claim.id && c.distinguishes.length >= 2 && c.cost <= constraints.maxCost && c.minutes <= constraints.maxMinutes && (!constraints.localOnly || c.location === 'local'));
  eligible.sort((a,b) => a.minutes-b.minutes || a.cost-b.cost || a.id.localeCompare(b.id));
  return { claim: claim.id, label, next: label === 'supported' ? null : eligible[0] ?? null, status: label === 'supported' ? 'no-check-needed' : eligible.length ? 'check-proposed' : 'no-feasible-check' };
}
