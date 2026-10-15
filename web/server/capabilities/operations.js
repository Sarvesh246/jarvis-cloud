import assert from 'node:assert/strict';

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

export const applicationSchema = Object.freeze([
  { id: 'applicant-name', label: 'Your name', required: true },
  { id: 'service-address', label: 'Service address', required: true },
  { id: 'proof-document', label: 'Proof of address document', required: true },
]);

/** Pure reducer keeps stable field identities, validation recovery, and an explicit review gate. */
export function transitionForm(state, event, schema = applicationSchema) {
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

/** This kernel only selects expert-approved fictional training instructions, never generates repair advice. */
export function procedureStep(procedure, context, completed = []) {
  if (!procedure.approvedBy || !procedure.approved || context.family !== procedure.family || context.revision !== procedure.revision)
    return { status: 'expert-required', reason: 'Unapproved or mismatched equipment/procedure' };
  if (context.conditions.some(item => !procedure.allowedConditions.includes(item)))
    return { status: 'expert-required', reason: 'Unexpected condition' };
  requireCondition(completed.every((id, index) => procedure.steps[index]?.id === id), 'Completion must be an ordered prefix');
  const step = procedure.steps[completed.length];
  if (!step) return { status: 'awaiting-outcome-verification', reason: 'Checklist completion does not establish success' };
  return { status: 'step', step: clone(step), provenance: procedure.source };
}

/** Compare explicit versions by stable project IDs. Names never determine identity. */
export function reconcileDocuments(authoritative, observed, fields = ['scope', 'date', 'partNumber', 'totalCents']) {
  const exceptions = [];
  for (const actual of observed) {
    const candidates = authoritative.filter(item => item.projectId === actual.projectId && item.approved);
    if (!candidates.length) { exceptions.push({ type: 'unmatched', projectId: actual.projectId, source: actual.source }); continue; }
    const maxVersion = Math.max(...candidates.map(item => item.version));
    const current = candidates.filter(item => item.version === maxVersion);
    if (current.length !== 1) { exceptions.push({ type: 'ambiguous-authority', projectId: actual.projectId, sources: current.map(item => item.source) }); continue; }
    const expected = current[0];
    for (const field of fields) {
      if (actual[field] === undefined || expected[field] === undefined) continue;
      if (actual[field] !== expected[field]) exceptions.push({ type: 'mismatch', projectId: actual.projectId, field,
        expected: expected[field], observed: actual[field], expectedSource: `${expected.source}#${field}`, observedSource: `${actual.source}#${field}` });
    }
  }
  return exceptions;
}

/** A fixed task registry preserves values and component identities across revisits. */
export function navigateStableView(state, task, registry) {
  requireCondition(Object.hasOwn(registry, task), 'Unsupported task');
  return { ...clone(state), history: [...state.history, state.task], task,
    controls: registry[task].map(field => ({ ...field, value: state.values[field.id] ?? '' })) };
}

/** Offline edits carry their base revision; remote conflicts stay unresolved until a person merges them. */
export function syncPacket(packet, remote, now) {
  const stale = Date.parse(now) > Date.parse(packet.expiresAt);
  const applied = [], conflicts = [], confirmations = [], documents = clone(remote);
  const persisted = new Set(packet.appliedOperationIds ?? []);
  const seen = new Set(persisted);
  for (const edit of packet.queue) {
    if (seen.has(edit.operationId)) continue;
    seen.add(edit.operationId);
    if (edit.requiresRemoteConfirmation) { confirmations.push(edit.operationId); continue; }
    const document = documents[edit.documentId];
    if (!document || document.revision !== edit.baseRevision || stale) {
      conflicts.push({ operationId: edit.operationId, reason: stale ? 'packet-expired' : !document ? 'missing-document' : 'revision-conflict', local: clone(edit), remote: clone(document ?? null) });
      continue;
    }
    documents[edit.documentId] = { revision: document.revision + 1, value: edit.value };
    applied.push(edit.operationId);
    persisted.add(edit.operationId);
  }
  return { stale, applied, conflicts, confirmations, documents, appliedOperationIds: [...persisted] };
}

/** Recorded write-intent is durable before I/O; unknown delivery is reconciled, never silently retried. */
export class ResumableWorkflow {
  constructor(snapshot) { this.state = clone(snapshot ?? { phase: 'planned', version: 1, key: 'case-001:submit:v1', attempts: 0 }); }
  prepare(resourceVersion) {
    requireCondition(this.state.phase === 'planned', 'Can only prepare a planned write');
    requireCondition(resourceVersion === this.state.version, 'Resource changed');
    this.state.phase = 'write-intent-recorded';
    return clone(this.state);
  }
  async dispatch(adapter) {
    requireCondition(this.state.phase === 'write-intent-recorded', 'No dispatchable write intent');
    this.state.phase = 'delivery-unknown';
    this.state.attempts++;
    try {
      const receipt = await adapter(this.state.key);
      this.state.receipt = receipt;
      this.state.phase = 'awaiting-readback';
    } catch (error) { this.state.lastError = String(error.message); }
    return clone(this.state);
  }
  reconcile(observation) {
    requireCondition(['delivery-unknown', 'awaiting-readback'].includes(this.state.phase), 'No pending write');
    if (observation?.key === this.state.key && observation.postcondition === true) this.state.phase = 'verified';
    else this.state.phase = 'human-review';
    return clone(this.state);
  }
}

/** Export only evidence-backed facts inside the granted support scope. */
export function buildHandoff({ caseId, facts, actions, unresolved, authority }) {
  const accepted = [], excluded = [];
  for (const fact of facts) {
    if (!fact.source || !authority.fields.includes(fact.field)) excluded.push({ field: fact.field, reason: !fact.source ? 'missing-source' : 'outside-authority' });
    else accepted.push(clone(fact));
  }
  return { caseId, facts: accepted, excluded, actions: actions.map(action => ({ ...clone(action), status: action.verified ? 'verified' : 'unverified' })),
    unresolved: clone(unresolved), authority: clone(authority), nextStep: 'Human reviews unresolved questions; no new action authority is implied.' };
}

/** Explicit mapping with referential, cardinality, and integer-cent reconciliation before cutover. */
export function validateMigration(source, target, mapping) {
  const issues = [], mapped = new Set();
  for (const [side, data] of [['source', source], ['target', target]]) {
    for (const invoice of data.invoices) {
      if (!Number.isSafeInteger(invoice.amountCents)) issues.push(`invalid amount ${side} ${invoice.id}`);
      if (!data.customers.some(customer => customer.id === invoice.customerId)) issues.push(`orphan invoice ${side} ${invoice.id}`);
    }
  }
  const mappedInvoices = Object.values(mapping.invoices).flat();
  if (new Set(mappedInvoices).size !== mappedInvoices.length) issues.push('many-to-one invoice mapping');
  for (const old of source.customers) {
    const destinations = mapping.customers[old.id] ?? [];
    if (destinations.length !== 1) { issues.push(`ambiguous customer ${old.id}`); continue; }
    if (mapped.has(destinations[0])) issues.push(`many-to-one customer ${destinations[0]}`);
    mapped.add(destinations[0]);
    if (!target.customers.some(customer => customer.id === destinations[0])) issues.push(`missing customer ${old.id}`);
  }
  for (const old of source.invoices) {
    const ids = mapping.invoices[old.id] ?? [];
    if (ids.length !== 1) { issues.push(`ambiguous invoice ${old.id}`); continue; }
    const current = target.invoices.filter(invoice => invoice.id === ids[0]);
    if (current.length !== 1) { issues.push(`missing or duplicate invoice ${old.id}`); continue; }
    if (current[0].customerId !== mapping.customers[old.customerId]?.[0]) issues.push(`broken relationship ${old.id}`);
    if (current[0].amountCents !== old.amountCents || current[0].currency !== old.currency) issues.push(`amount or currency mismatch ${old.id}`);
  }
  for (const group of ['customers', 'invoices']) {
    const ids = target[group].map(item => item.id);
    if (new Set(ids).size !== ids.length) issues.push(`duplicate target ${group} IDs`);
    const expected = new Set(Object.values(mapping[group]).flat());
    if (target[group].some(item => !expected.has(item.id))) issues.push(`unmapped target ${group}`);
    if (source[group].length !== target[group].length) issues.push(`record count mismatch ${group}`);
  }
  const totals = records => Object.fromEntries([...new Set(records.map(item => item.currency))].sort().map(currency => [currency, records.filter(item => item.currency === currency).reduce((sum, item) => sum + item.amountCents, 0)]));
  const sourceTotals = totals(source.invoices), targetTotals = totals(target.invoices);
  if (JSON.stringify(sourceTotals) !== JSON.stringify(targetTotals)) issues.push('currency totals mismatch');
  return { canCutover: issues.length === 0, issues, sourceTotals, targetTotals };
}
