import { isDeepStrictEqual } from 'node:util';
import { CAPABILITIES, getCapability } from '../shared/capabilities.js';
import * as memory from './capabilities/memory.js';
import * as operations from './capabilities/operations.js';
import * as verification from './capabilities/verification.js';
import * as evaluation from './capabilities/evaluation.js';
import { verifyObservation, digest } from './capabilities/verifier.js';

export { CAPABILITIES };
export class CapabilityInputError extends Error {
  constructor(message) { super(message); this.name = 'CapabilityInputError'; this.statusCode = 400; }
}
const fail = message => { throw new CapabilityInputError(message); };
const requireInput = (condition, message) => { if (!condition) fail(message); };

// A single finite JSON budget applies even inside open-ended maps.
function bound(value, depth = 0, budget = { nodes: 0 }) {
  requireInput(depth <= 12 && ++budget.nodes <= 10000, 'Input is too deeply nested or too large.');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') { requireInput(Number.isFinite(value), 'Numbers must be finite.'); return; }
  if (typeof value === 'string') { requireInput(value.length <= 20000, 'Text fields are limited to 20,000 characters.'); return; }
  requireInput(value && typeof value === 'object', 'Input must contain JSON values only.');
  if (Array.isArray(value)) { requireInput(value.length <= 100, 'Lists are limited to 100 entries.'); value.forEach(v => bound(v, depth + 1, budget)); return; }
  requireInput(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null, 'Input must contain plain JSON objects.');
  requireInput(Object.keys(value).length <= 100, 'Objects are limited to 100 fields.');
  for (const [key, child] of Object.entries(value)) {
    requireInput(!['__proto__', 'constructor', 'prototype'].includes(key), 'Unsafe object field.');
    requireInput(key.length <= 200, 'Field names are too long.'); bound(child, depth + 1, budget);
  }
}
function validate(value, schema, path = 'input') {
  const type = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
  requireInput(type === schema.type, `${path}: expected ${schema.type}.`);
  if (schema.enum) requireInput(schema.enum.includes(value), `${path}: select a supported value.`);
  if (schema.type === 'string' && schema.description?.startsWith('ISO 8601')) requireInput(Number.isFinite(Date.parse(value)) && /(?:Z|[+-]\d\d:\d\d)$/.test(value), `${path}: enter a date/time with timezone.`);
  if (schema.type === 'object' && schema.properties) {
    for (const key of schema.required ?? []) requireInput(Object.hasOwn(value, key), `${path}.${key}: required.`);
    for (const [key, child] of Object.entries(value)) {
      requireInput(Object.hasOwn(schema.properties, key), `${path}.${key}: unsupported field.`);
      validate(child, schema.properties[key], `${path}.${key}`);
    }
  }
  if (schema.type === 'array') value.forEach((v, i) => validate(v, schema.items, `${path}[${i}]`));
}
function unique(rows, key = 'id') {
  requireInput(rows.every(r => typeof r[key] === 'string' && r[key].trim()) && new Set(rows.map(r => r[key])).size === rows.length, `Records need unique nonempty ${key} values.`);
}
function nonnegative(value, name) { requireInput(Number.isFinite(value) && value >= 0, `${name} must be nonnegative.`); }
function behavioral(cases, before, after) {
  requireInput(cases.length > 0, 'At least one acceptance case is required.'); unique(cases);
  return memory.compareBehavior(cases.map(c => ({ ...c, accept: value => isDeepStrictEqual(value, c.expected) })), before, after);
}
function compareManifests(input) {
  nonnegative(input.tolerance, 'Tolerance');
  requireInput(Object.keys(input.expected).length > 0, 'Expected outputs must not be empty.');
  const outputs = Object.entries(input.expected).map(([key, expected]) => {
    requireInput(typeof expected === 'number', 'Expected outputs must be numeric.');
    const observed = input.observed[key];
    return { key, expected, observed: observed ?? null, status: typeof observed !== 'number' ? 'unverified' : Math.abs(observed - expected) <= input.tolerance ? 'matched' : 'discrepancy' };
  });
  const environmentMatches = isDeepStrictEqual(input.expectedEnvironment, input.observedEnvironment);
  return { status: outputs.every(o => o.status === 'matched') && environmentMatches ? 'supplied-manifests-match' : 'review-required', outputs, environmentMatches, executedCode: false,
    unexpectedOutputs: Object.keys(input.observed).filter(k => !Object.hasOwn(input.expected, k)) };
}
function safeExperiment(input) {
  requireInput(input.predictions.length === 2, 'Supply exactly two predictions.'); unique(input.predictions);
  let actual;
  if (input.operation === 'contains-text') {
    requireInput(typeof input.text === 'string' && typeof input.needle === 'string', 'Text and search text are required.'); actual = input.text.includes(input.needle);
  } else {
    requireInput(Array.isArray(input.numbers) && input.numbers.length > 0, 'Supply at least one number.');
    if (input.operation === 'sum') actual = input.numbers.reduce((a, b) => a + b, 0);
    if (input.operation === 'mean') actual = input.numbers.reduce((a, b) => a + b, 0) / input.numbers.length;
    if (input.operation === 'sort-numbers') actual = [...input.numbers].sort((a, b) => a - b);
    if (input.operation === 'unique-count') actual = new Set(input.numbers).size;
    requireInput(Array.isArray(actual) || Number.isFinite(actual), 'Result exceeds supported numeric range.');
  }
  const predictions = input.predictions.map(p => {
    let value; try { value = JSON.parse(p.value); } catch { fail(`Prediction ${p.id} must be valid JSON.`); }
    bound(value); return { id: p.id, value, matches: isDeepStrictEqual(value, actual) };
  });
  return { status: isDeepStrictEqual(predictions[0].value, predictions[1].value) ? 'predictions-do-not-disagree' : 'observed', operation: input.operation, actual, predictions,
    supported: predictions.filter(p => p.matches).map(p => p.id), observationDigest: digest({ operation: input.operation, actual }), arbitraryCodeExecuted: false };
}
function migrationInput(i) {
  unique(i.records); return { selected: i.selected, tombstones: i.tombstones ?? [] };
}

export async function runCapability(capabilityId, input, { now = Date.now() } = {}) {
  requireInput((typeof capabilityId === 'number' || typeof capabilityId === 'string') && /^\d+$/.test(String(capabilityId)), 'Capability ID must be an integer from 1 to 36.');
  const capability = getCapability(capabilityId); requireInput(!!capability, 'Unknown capability.');
  bound(input); requireInput(JSON.stringify(input).length <= 150000, 'Input exceeds 150 KB.'); validate(input, capability.inputSchema);
  const nowMs = typeof now === 'number' ? now : Date.parse(now); requireInput(Number.isFinite(nowMs), 'Invalid evaluation time.');
  const at = new Date(nowMs).toISOString(); const i = structuredClone(input); let result;
  const limitations = ['Computed from the information you supplied. Source authenticity and completeness are not independently verified.', 'This run does not execute external actions, contact providers, schedule monitoring, revoke access, or prove real-world completion.'];
  try {
    switch (capability.id) {
      case 1: {
        requireInput(!!i.observation, 'Select a saved Vaelo document for independent readback or provide an observed state.');
        if (i.maxAgeMs !== undefined) nonnegative(i.maxAgeMs, 'Maximum readback age');
        const contract = { ...i.contract, checks: i.contract.checks.map(c => ({ ...c, expected: typeof c.expected === 'string' ? JSON.parse(c.expected) : c.expected })) };
        result = verifyObservation(contract, i.observation, { now: nowMs, maxAgeMs: i.maxAgeMs ?? 60000 });
        result.status = result.status === 'completed' ? 'supplied-state-satisfies-checks' : result.status;
        limitations.push('Readback was supplied by you rather than independently fetched from a provider.'); break;
      }
      case 2: case 34: result = memory.reviewCorrection(i.nodes, i.correctedIds); break;
      case 3:
        requireInput(Number.isSafeInteger(i.record.expectedCents) && i.record.expectedCents > 0, 'Expected refund must be positive integer cents.');
        result = operations.evaluateConsumerCase(i.record, i.observations, at); break;
      case 4:
        unique(i.fields); result = operations.transitionForm({ values: i.values, errors: {}, reviewed: false }, { type: 'review' }, i.fields); break;
      case 5: unique(i.procedure.steps); result = operations.procedureStep(i.procedure, i.context, i.completed); break;
      case 6: result = { exceptions: operations.reconcileDocuments(i.authoritative, i.observed, i.fields), externalDocumentsChanged: false }; break;
      case 7:
        if (i.minimumDelayHours !== undefined) nonnegative(i.minimumDelayHours, 'Delay'); result = evaluation.assessTransfer(i); break;
      case 8: result = compareManifests(i); limitations.push('No paper environment or code was run. Matching supplied manifests does not establish computational reproduction or scientific validity.'); break;
      case 9: case 33: {
        const plan = verification.choosePlan(i.members, i.options, { fairness: i.fairness });
        result = { proposal: verification.groupDisclosure(plan, i.members), privateReview: plan, committed: false };
        limitations.push('Private burden details in this result are for the submitting user. Do not share the private review as a group-safe disclosure; schedules can reveal availability indirectly.'); break;
      }
      case 10:
        for (const controls of Object.values(i.registry)) requireInput(Array.isArray(controls) && controls.every(c => c && typeof c.id === 'string' && typeof c.label === 'string'), 'Registry entries must be control arrays with IDs and labels.');
        result = operations.navigateStableView({ task: i.currentTask, values: i.values, history: i.history }, i.task, i.registry); break;
      case 11:
        unique(i.packet.queue, 'operationId');
        for (const doc of Object.values(i.remote)) requireInput(Number.isSafeInteger(doc.revision) && doc.revision >= 0, 'Document revisions must be nonnegative integers.');
        result = { ...operations.syncPacket(i.packet, i.remote, at), previewOnly: true }; limitations.push('Applying returned documents requires atomically persisting the operation ledger and document revisions.'); break;
      case 12:
        nonnegative(i.constraints.years, 'Ownership years'); nonnegative(i.constraints.budget, 'Budget');
        i.items.forEach(item => { nonnegative(item.price, 'Price'); nonnegative(item.annualCost, 'Annual cost'); });
        result = evaluation.rankPurchases(i.items, i.constraints); break;
      case 13: result = memory.migrateRecords(i.records, migrationInput(i)); break;
      case 14: result = behavioral(i.cases, i.before, i.after); limitations.push('No model was invoked. Results compare your supplied outputs against your selected structured expectations.'); break;
      case 15: {
        const workflow = new operations.ResumableWorkflow(i.snapshot);
        result = ['delivery-unknown', 'awaiting-readback'].includes(i.snapshot.phase) ? workflow.reconcile(i.observation) : { ...i.snapshot, nextStep: i.snapshot.phase === 'planned' ? 'Prepare an authorized write intent before dispatch.' : 'Review the saved state; this tool will not dispatch or retry an action.' };
        result.externalActionRetried = false; break;
      }
      case 16: result = { alerts: evaluation.researchChanges(i.previous, i.next, { asOf: at, seen: i.seen ?? [] }), monitorCreated: false }; break;
      case 17: result = memory.disclosureGateway(i.payload, i); limitations.push('Allowed free-text fields may still contain private information. Arrays require an explicit supported schema.'); break;
      case 18: result = memory.checkScope(i.action, i.policy, nowMs); break;
      case 19:
        requireInput(i.constraints.length <= 12, 'At most 12 constraints are supported.');
        requireInput(i.maxRelaxed === undefined || Number.isInteger(i.maxRelaxed) && i.maxRelaxed >= 0 && i.maxRelaxed <= 4, 'Maximum relaxed constraints must be an integer from zero to four.');
        result = verification.permittedRelaxations(i.options, i.constraints, i.maxRelaxed ?? 2); break;
      case 20: result = { alerts: evaluation.policyChanges(i.before, i.after, { watchFields: i.watchFields }, { asOf: at, seen: i.seen ?? [] }), monitorCreated: false }; break;
      case 21: result = evaluation.reassessDecision(i.decision, i.observations, at); break;
      case 22: result = operations.buildHandoff(i); limitations.push('Fact-field selection does not redact free-text actions or unresolved questions. Review the packet before sharing.'); break;
      case 23: result = { contradictions: verification.contradictionMap(i.claims), documentChangesApplied: false }; break;
      case 24:
        for (const data of [i.source, i.target]) {
          requireInput(Array.isArray(data.customers) && Array.isArray(data.invoices), 'Systems require customer and invoice lists.'); unique(data.customers); unique(data.invoices);
          for (const invoice of data.invoices) requireInput(typeof invoice.currency === 'string' && /^[A-Z]{3}$/.test(invoice.currency), 'Each invoice requires an explicit three-letter uppercase currency code.');
        }
        requireInput(i.mapping.customers && i.mapping.invoices && Object.values(i.mapping.customers).every(Array.isArray) && Object.values(i.mapping.invoices).every(Array.isArray), 'Mappings require customer and invoice maps of target-ID lists.');
        result = operations.validateMigration(i.source, i.target, i.mapping); break;
      case 25: result = verification.recordProcedure(i.trace, i.postconditions); break;
      case 26: result = evaluation.correctVocabulary(i.text, i.records, i.scope); break;
      case 27:
        Object.entries(i.policy).filter(([k]) => !['localOnly'].includes(k)).forEach(([k, v]) => nonnegative(v, k));
        requireInput(i.policy.minimumSuccess <= 1 && i.policy.minimumSuccess > 0 && i.policy.minimumSamples >= 1 && Number.isInteger(i.policy.minimumSamples), 'Require success fraction in (0,1] and at least one integer sample.');
        i.models.forEach(model => requireInput(Object.values(model.outcomes).every(v => Array.isArray(v) && v.every(x => typeof x === 'boolean')), 'Outcomes must be boolean lists by task.'));
        result = evaluation.routeByOutcome(i.models, i.task, i.policy); break;
      case 28: result = verification.prepareFailureRecipe(i); limitations.push('Sensitive-content screening is incomplete. Explicit human review is required; nothing has been published.'); break;
      case 29: {
        const boundary = new memory.ContextBoundary(i.records);
        result = { records: boundary.read({ principal: i.principal, context: i.context, revision: 'request-policy', allowedContexts: i.allowedContexts }, i.query), context: i.context, disclosure: 'Only this declared retrieval context was searched.' };
        limitations.push('This is a policy preview using supplied identity and grants; it does not establish authentication or protect other Vaelo chat context.'); break;
      }
      case 30:
        nonnegative(i.constraints.maxCost, 'Cost limit'); nonnegative(i.constraints.maxMinutes, 'Time limit'); i.checks.forEach(c => { nonnegative(c.cost, 'Check cost'); nonnegative(c.minutes, 'Check minutes'); });
        result = evaluation.nextCheck(i.claim, i.checks, i.constraints, at); break;
      case 31: result = verification.effortBudget(i.entries, i); break;
      case 32: {
        const migration = memory.migrateRecords(i.records, migrationInput(i)); const comparison = behavioral(i.cases, i.before, i.after);
        const forbiddenTransfers = migration.records.filter(r => i.prohibitedIds.includes(r.id)).map(r => r.id);
        result = { migration, comparison, forbiddenTransfers, canProceed: comparison.canProceed && forbiddenTransfers.length === 0 }; break;
      }
      case 35: result = safeExperiment(i); limitations.push('Only the selected built-in operation was executed. This observation cannot resolve arbitrary factual or scientific disagreements.'); break;
      case 36: {
        const bundle = memory.exitPackage(i, migrationInput(i));
        const testImport = memory.migrateRecords(bundle.context.map(r => ({ ...r, owned: true })), { tombstones: bundle.migration.tombstones });
        result = { ...bundle, testImport: { importedIds: testImport.records.map(r => r.id), scope: 'local-supported-record-format' } };
        limitations.push('Workflow descriptions are not executable migrations; no vendor data deletion or credential revocation has occurred.'); break;
      }
      default: fail('Unsupported capability.');
    }
    const serialized = JSON.stringify(result, (_key, value) => {
      requireInput(typeof value !== 'number' || Number.isFinite(value), 'Computation exceeds the supported numeric range.');
      return value;
    }); requireInput(serialized.length <= 300000, 'Result exceeds the supported output size.');
    return { status: 'computed', summary: `${capability.title}: review the computed result and its evidence limits.`, result: JSON.parse(serialized), limitations };
  } catch (error) {
    if (error instanceof CapabilityInputError) throw error;
    throw new CapabilityInputError(error?.message || 'Input could not be evaluated.');
  }
}
