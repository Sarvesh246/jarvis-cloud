import assert from 'node:assert/strict';

// A support group is an AND clause; multiple groups are alternatives (OR).
// Least-fixed-point grounding prevents cycles from supporting themselves.
export function reviewCorrection(nodes, correctedIds, { complete = false } = {}) {
  const byId = new Map(nodes.map(n => [n.id, n]));
  assert.equal(byId.size, nodes.length, 'Duplicate provenance ID');
  const corrected = new Set(correctedIds);
  for (const id of corrected) assert.ok(byId.has(id), 'Unknown correction');
  for (const n of nodes) for (const group of n.support ?? []) {
    assert.ok(group.length > 0, 'Empty support group');
    for (const id of group) assert.ok(byId.has(id), 'Unknown provenance reference');
  }
  const grounded = new Set(nodes.filter(n => n.trusted === true && !corrected.has(n.id)).map(n => n.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const n of nodes) if (!grounded.has(n.id) && !corrected.has(n.id) &&
      (n.support ?? []).some(group => group.every(id => grounded.has(id)))) {
      grounded.add(n.id); changed = true;
    }
  }
  const affected = new Set(corrected);
  changed = true;
  while (changed) {
    changed = false;
    for (const n of nodes) if (!affected.has(n.id) &&
      (n.support ?? []).some(group => group.some(id => affected.has(id)))) {
      affected.add(n.id); changed = true;
    }
  }
  const result = { keep: [], recheck: [], pause: [], compensate: [], invalidated: [], coverage: complete ? 'declared-complete' : 'partial' };
  for (const n of nodes) {
    if (!affected.has(n.id) || grounded.has(n.id)) result.keep.push(n.id);
    else {
      result.invalidated.push(n.id);
      const bucket = n.kind === 'pending' ? 'pause' : n.kind === 'completed' ? 'compensate' : 'recheck';
      result[bucket].push(n.id);
    }
  }
  return result;
}

export const migrationProfile = Object.freeze({
  kinds: ['fact', 'preference', 'project'],
  fields: ['id', 'kind', 'text', 'context', 'source', 'stated', 'exceptions'],
});

export function migrateRecords(records, { selected, tombstones = [], existing = [], profile = migrationProfile } = {}) {
  const selectedIds = new Set(selected ?? records.map(r => r.id));
  const deleted = new Set(tombstones);
  const imported = existing.filter(r => !deleted.has(r.id)).map(r => structuredClone(r));
  const ids = new Set(imported.map(r => r.id));
  const report = { imported: [], excluded: [], rejected: [], losses: [], tombstones: [...deleted] };
  for (const record of records) {
    const id = record.id;
    if (!selectedIds.has(id) || record.transfer === false || record.owned !== true || deleted.has(id)) {
      report.excluded.push({ id, reason: deleted.has(id) ? 'tombstone' : 'selection-or-consent' }); continue;
    }
    if (typeof id !== 'string' || !id || typeof record.text !== 'string' || !record.text.trim() ||
      !profile.kinds.includes(record.kind) || ids.has(id)) {
      report.rejected.push({ id: id ?? null, reason: ids.has(id) ? 'duplicate-or-collision' : 'unsupported-or-malformed' }); continue;
    }
    const mapped = {};
    for (const [field, value] of Object.entries(record)) {
      if (profile.fields.includes(field)) mapped[field] = structuredClone(value);
      else if (!['owned', 'transfer'].includes(field)) report.losses.push({ id, field });
    }
    ids.add(id); imported.push(mapped); report.imported.push(id);
  }
  return { records: imported, report };
}

export function retrieve(records, query, context, tombstones = []) {
  const terms = query.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const deleted = new Set(tombstones);
  return records.filter(r => r.context === context && !deleted.has(r.id)).map(record => ({ record,
    score: terms.reduce((n, term) => n + Number(record.text.toLowerCase().includes(term)), 0),
  })).filter(r => r.score > 0).sort((a, b) => b.score - a.score || a.record.id.localeCompare(b.record.id)).map(r => r.record);
}

export function compareBehavior(cases, before, after) {
  const rows = cases.map(c => {
    if (!(c.id in before) || !(c.id in after)) return { id: c.id, critical: !!c.critical, status: 'untestable' };
    const oldPass = !!c.accept(before[c.id]);
    const newPass = !!c.accept(after[c.id]);
    return { id: c.id, critical: !!c.critical, beforePass: oldPass, afterPass: newPass,
      status: oldPass && !newPass ? 'regression' : !oldPass && newPass ? 'improvement' : newPass ? 'preserved' : 'still-failing' };
  });
  return { rows, canProceed: rows.every(r => r.status !== 'untestable' && r.status !== 'regression' && (!r.critical || r.afterPass)),
    regressions: rows.filter(r => r.status === 'regression').map(r => r.id) };
}

function leaves(value, prefix = '') {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), 'Only structured objects supported');
  const out = [];
  for (const [key, child] of Object.entries(value)) {
    assert.ok(!['__proto__', 'constructor', 'prototype'].includes(key), 'Unsafe path');
    assert.ok(!key.includes('.'), 'Dotted field names unsupported');
    const path = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) out.push(...leaves(child, path));
    else { assert.ok(!Array.isArray(child), 'Array disclosure requires a schema'); out.push([path, child]); }
  }
  return out;
}

export function disclosureGateway(payload, { allowed = [], required = [], purpose, audience } = {}) {
  assert.ok(purpose && audience, 'Purpose and audience required');
  const entries = leaves(payload);
  const allow = new Set(allowed);
  for (const path of required) assert.ok(allow.has(path) && entries.some(([p]) => p === path), `Missing required field: ${path}`);
  const projected = {};
  for (const [path, value] of entries) if (allow.has(path)) {
    const parts = path.split('.'); let target = projected;
    for (const part of parts.slice(0, -1)) target = target[part] ??= {};
    target[parts.at(-1)] = structuredClone(value);
  }
  return { payload: projected, receipt: { audience, purpose, disclosed: entries.filter(([p]) => allow.has(p)).map(([p]) => p),
    withheld: entries.filter(([p]) => !allow.has(p)).map(([p]) => p) } };
}

export function checkScope(action, policy, now = 1000) {
  const reasons = [];
  const known = ['operation', 'resource', 'context', 'fields', 'recipient', 'amount'];
  if (Object.keys(action).some(k => !known.includes(k))) reasons.push('unknown-action-field');
  if (!Number.isFinite(policy.expires) || now >= policy.expires) reasons.push('expired');
  if (!policy.operations?.includes(action.operation)) reasons.push('operation');
  // Exact resource IDs intentionally avoid prefix/path traversal matches.
  if (!policy.resources?.includes(action.resource)) reasons.push('resource');
  if (action.context !== policy.context) reasons.push('context');
  if (!Array.isArray(action.fields) || action.fields.some(f => !policy.fields?.includes(f))) reasons.push('fields');
  if (action.recipient !== undefined && !policy.recipients?.includes(action.recipient)) reasons.push('recipient');
  if (action.amount !== undefined && (!Number.isFinite(action.amount) || action.amount < 0 ||
    !Number.isFinite(policy.maxAmount) || action.amount > policy.maxAmount)) reasons.push('amount');
  return { allowed: reasons.length === 0, reasons };
}

export class ContextBoundary {
  #cache = new Map();
  constructor(records) { this.records = structuredClone(records); }
  read({ principal, context, revision, allowedContexts }, query) {
    assert.ok(principal && context && revision, 'Identity and policy revision required');
    assert.ok(allowedContexts.includes(context), 'Context denied');
    const key = JSON.stringify([principal, context, revision, [...allowedContexts].sort(), query]);
    if (!this.#cache.has(key)) this.#cache.set(key, retrieve(this.records, query, context));
    return structuredClone(this.#cache.get(key));
  }
  revoke() { this.#cache.clear(); }
}

export function exitPackage({ records, workflows, pending, access }, options) {
  const migration = migrateRecords(records, options);
  const supported = new Set(migration.records.map(r => r.id));
  return { version: 1, context: migration.records, migration: migration.report,
    readable: migration.records.map(r => `- ${r.id} [${r.context}]: ${r.text}`).join('\n'),
    workflows: workflows.map(w => ({ ...structuredClone(w), executionStatus: 'description-only' })),
    pending: pending.map(p => ({ ...structuredClone(p), importStatus: p.dependsOn.every(id => supported.has(id)) ? 'review-before-resume' : 'blocked-missing-context' })),
    revocations: access.map(a => ({ provider: a.provider, permission: a.permission, status: 'user-action-required', deletionProven: false })) };
}
