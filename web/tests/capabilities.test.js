import test from 'node:test';
import assert from 'node:assert/strict';
import { runCapability, CapabilityInputError, CAPABILITIES } from '../server/capability-engine.js';

const now = Date.parse('2026-10-15T15:00:00Z');
const at = '2026-10-15T15:00:00Z', future = '2026-11-15T15:00:00Z';
const record = { id: 'm', kind: 'fact', text: 'Garden calendar', context: 'personal', owned: true };
const nodes = [{ id: 'source', kind: 'fact', trusted: true }, { id: 'task', kind: 'pending', support: [['source']] }];
const system = { customers: [{ id: 'c' }], invoices: [{ id: 'i', customerId: 'c', amountCents: 100, currency: 'USD' }] };
const document = { projectId: 'p', version: 1, approved: true, source: 'quote', scope: 'Paint' };
const claim = { id: 'c', finding: 'Result', sourceVersion: 'v1', expiresAt: future };
const planning = { members: [{ id: 'a', acceptable: ['morning'], costs: { morning: 1 } }], options: ['morning'], fairness: 'total' };
const inputs = {
  1: { contract: { id: 'c', resource: { kind: 'document', id: 'd' }, checks: [{ id: 'title', path: ['title'], op: 'equals', expected: '"Report"' }] }, observation: { available: true, resource: { kind: 'document', id: 'd' }, observedAt: at, state: { title: 'Report' } } },
  2: { nodes, correctedIds: ['source'] },
  3: { record: { id: 'c', orderId: 'o', expectedCents: 100, currency: 'USD', followupAt: at }, observations: [{ transactionId: 't', source: 'bank', orderId: 'o', currency: 'USD', amountCents: 100, status: 'settled' }] },
  4: { fields: [{ id: 'name', label: 'Name', required: true }], values: { name: 'Test' } },
  5: { procedure: { family: 'fixture', revision: '1', approvedBy: 'expert', approved: true, allowedConditions: ['off'], source: 'manual', steps: [{ id: 'one', text: 'Inspect' }] }, context: { family: 'fixture', revision: '1', conditions: ['off'] }, completed: [] },
  6: { authoritative: [document], observed: [{ ...document, scope: 'Different' }] },
  7: { baseline: [{ task: 'b', at, assistance: 0, correct: false }], practice: [{ task: 'p', at: '2026-10-13T15:00:00Z', assistance: 1, correct: true }], delayed: [{ task: 'new', at, assistance: 0, correct: true }] },
  8: { expected: { mean: 3 }, observed: { mean: 3 }, expectedEnvironment: { node: '24' }, observedEnvironment: { node: '24' }, tolerance: 0 },
  9: planning,
  10: { task: 'report', currentTask: 'home', history: [], values: { title: 'Saved' }, registry: { report: [{ id: 'title', label: 'Title' }] } },
  11: { packet: { expiresAt: future, queue: [{ operationId: 'o', documentId: 'd', baseRevision: 1, value: { title: 'New' } }] }, remote: { d: { revision: 1, value: { title: 'Old' } } } },
  12: { items: [{ id: 'used', price: 10, annualCost: 2, commercialRelationship: 'none', verifiedAt: at, specs: { repairable: true } }], constraints: { years: 2, budget: 20, excludeCommercial: true, requires: { repairable: true }, asOf: at } },
  13: { records: [record] },
  14: { cases: [{ id: 'c', critical: true, expected: { permitted: true } }], before: { c: { permitted: true } }, after: { c: { permitted: true } } },
  15: { snapshot: { phase: 'delivery-unknown', version: 1, key: 'intent', attempts: 1 }, observation: { key: 'intent', postcondition: true } },
  16: { previous: [claim], next: [{ ...claim, finding: 'Changed', sourceVersion: 'v2' }] },
  17: { payload: { name: 'Test', secret: 'hidden' }, allowed: ['name'], purpose: 'preview', audience: 'calendar' },
  18: { action: { operation: 'update', resource: 'event:1', context: 'personal', fields: ['start'] }, policy: { operations: ['update'], resources: ['event:1'], context: 'personal', fields: ['start'], expires: now + 1000 } },
  19: { options: ['a', 'b'], constraints: [{ id: 'first', allowed: ['a'], mayRelax: true }, { id: 'second', allowed: ['b'], mayRelax: false }] },
  20: { before: { terms: { fee: 1 } }, after: { id: 'policy', version: '2', effectiveAt: future, terms: { fee: 2 } }, watchFields: ['fee'] },
  21: { decision: { id: 'd', reviewAt: at, evidence: [], assumptions: [{ key: 'requirement', value: { enabled: true } }] }, observations: { requirement: { enabled: true } } },
  22: { caseId: 'c', facts: [{ field: 'order', value: 'o', source: 'receipt' }], actions: [{ description: 'Drafted', verified: false }], unresolved: ['Refund pending'], authority: { fields: ['order'] } },
  23: { claims: [{ entityId: 'p', field: 'scope', scope: 'job', effectiveFrom: at, value: 'A', source: { document: 'quote', location: '1' } }, { entityId: 'p', field: 'scope', scope: 'job', effectiveFrom: at, value: 'B', source: { document: 'invoice', location: '2' } }] },
  24: { source: system, target: system, mapping: { customers: { c: ['c'] }, invoices: { i: ['i'] } } },
  25: { trace: { id: 'trace', supervised: true, status: 'completed', steps: [{ tool: 'editor', resourceTemplate: 'document:{id}', inputSchema: { id: 'string' } }] }, postconditions: [{ path: ['title'], op: 'equals', expected: 'Report', status: 'passed' }] },
  26: { text: 'calender', records: [{ heard: 'calender', intended: 'calendar', confirmed: true, user: 'u', occupation: 'planner', languagePair: 'en-en' }], scope: { user: 'u', occupation: 'planner', languagePair: 'en-en' } },
  27: { models: [{ id: 'm', cost: 1, verificationCost: 0.1, latencyMs: 20, verificationLatencyMs: 1, retentionDays: 0, location: 'local', outcomes: { edit: [true, true] } }], task: 'edit', policy: { localOnly: true, maxRetentionDays: 0, minimumSamples: 2, maxCost: 2, maxLatencyMs: 30, minimumSuccess: 0.9 } },
  28: { consent: true, tool: 'editor', version: '1', environment: 'sandbox', reproduction: 'Open blank document', observed: 'Empty title', expected: 'Saved title' },
  29: { records: [{ id: 'p', text: 'calendar', context: 'personal' }, { id: 'c', text: 'calendar secret', context: 'client' }], principal: 'u', context: 'personal', allowedContexts: ['personal'], query: 'calendar' },
  30: { claim: { id: 'c', evidence: [] }, checks: [{ id: 'test', claim: 'c', distinguishes: ['a', 'b'], cost: 1, minutes: 1, location: 'local' }], constraints: { maxCost: 2, maxMinutes: 2, localOnly: true } },
  31: { entries: [{ id: 'e', at, minutes: 5, kind: 'review' }], limitMinutes: 3, periodStart: '2026-10-15T00:00:00Z', periodEnd: future },
  32: { records: [record], cases: [{ id: 'c', expected: { project: 'Garden' } }], before: { c: { project: 'Garden' } }, after: { c: { project: 'Garden' } }, prohibitedIds: ['client'] },
  33: planning,
  34: { nodes, correctedIds: ['source'] },
  35: { operation: 'sort-numbers', numbers: [2, 10, 1], predictions: [{ id: 'numeric', value: '[1,2,10]' }, { id: 'lexical', value: '[1,10,2]' }] },
  36: { records: [record], workflows: [{ id: 'w', text: 'Review weekly' }], pending: [{ id: 't', dependsOn: ['m'] }], access: [{ provider: 'calendar', permission: 'write' }] },
};

test('all 36 capabilities have schemas, execute user inputs and preserve input values', async () => {
  assert.deepEqual(CAPABILITIES.map(c => c.id), Array.from({ length: 36 }, (_, i) => i + 1));
  for (const c of CAPABILITIES) {
    assert.equal(c.inputSchema.type, 'object'); assert.ok(c.description && c.title && c.group);
    const original = structuredClone(inputs[c.id]);
    const output = await runCapability(c.id, inputs[c.id], { now });
    assert.equal(output.status, 'computed', `Capability ${c.id}`); assert.ok(output.result && output.summary && output.limitations.length);
    assert.deepEqual(inputs[c.id], original);
    assert.deepEqual(await runCapability(c.id, inputs[c.id], { now }), output, `Deterministic ${c.id}`);
  }
});

test('reject invalid capability, types, unknown fields, unsafe keys, unbounded lists and nonfinite numbers', async () => {
  for (const [id, input] of [[0, {}], [37, {}], ['1x', {}], [13, {}], [13, { records: 'bad' }], [13, { records: [], unknown: true }],
    [13, { records: Array(101).fill(record) }], [17, { ...inputs[17], payload: JSON.parse('{"__proto__":{"x":1}}') }],
    [35, { ...inputs[35], numbers: [Infinity] }]]) {
    await assert.rejects(runCapability(id, input, { now }), error => error instanceof CapabilityInputError && error.statusCode === 400);
  }
});

test('verification rejects unavailable/stale/wrong resource evidence and empty checks', async () => {
  for (const patch of [{ available: false }, { resource: { kind: 'document', id: 'other' } }, { observedAt: '2026-10-14T15:00:00Z' }]) {
    const result = await runCapability(1, { ...inputs[1], observation: { ...inputs[1].observation, ...patch } }, { now });
    assert.equal(result.result.status, 'unverified');
  }
  await assert.rejects(runCapability(1, { ...inputs[1], contract: { ...inputs[1].contract, checks: [] } }, { now }), /acceptance checks/);
  await assert.rejects(runCapability(1, { contract: inputs[1].contract }, { now }), /saved Vaelo document/);
});

test('correction preserves independently supported state and cannot ground a cycle', async () => {
  const nodes = [{ id: 'a', kind: 'fact', trusted: true }, { id: 'b', kind: 'fact', trusted: true },
    { id: 'cycle', kind: 'conclusion', support: [['a'], ['cycle']] }, { id: 'independent', kind: 'artifact', support: [['a'], ['b']] }];
  const { result } = await runCapability(2, { nodes, correctedIds: ['a'] }, { now });
  assert.ok(result.invalidated.includes('cycle')); assert.ok(result.keep.includes('independent'));
});

test('migration excludes tombstones and privacy exclusions; model gates do not average away regressions', async () => {
  const migrated = await runCapability(13, { records: [record, { ...record, id: 'private', transfer: false }], tombstones: ['m'] }, { now });
  assert.deepEqual(migrated.result.records, []);
  const compared = await runCapability(14, { ...inputs[14], after: { c: { permitted: false } } }, { now });
  assert.equal(compared.result.canProceed, false);
  await assert.rejects(runCapability(14, { cases: [], before: {}, after: {} }, { now }), /At least one/);
});

test('authorization denies drift and revoked context; disclosure removes values as well as fields', async () => {
  const denied = await runCapability(18, { ...inputs[18], action: { ...inputs[18].action, resource: 'event:10' } }, { now });
  assert.equal(denied.result.allowed, false);
  await assert.rejects(runCapability(29, { ...inputs[29], allowedContexts: [] }, { now }), /denied/);
  const projected = await runCapability(17, inputs[17], { now });
  assert.equal(projected.result.payload.secret, undefined); assert.ok(!JSON.stringify(projected).includes('hidden'));
});

test('bounded research rejects arbitrary code and preserves reproduction/exit limitations', async () => {
  const mismatch = await runCapability(8, { ...inputs[8], observed: { mean: 4 } }, { now });
  assert.equal(mismatch.result.status, 'review-required'); assert.equal(mismatch.result.executedCode, false);
  await assert.rejects(runCapability(35, { ...inputs[35], operation: 'eval' }, { now }), /supported/);
  await assert.rejects(runCapability(35, { ...inputs[35], predictions: [{ id: 'a', value: 'process.exit()' }, { id: 'b', value: 'null' }] }, { now }), /valid JSON/);
  const compared = await runCapability(35, inputs[35], { now }); assert.deepEqual(compared.result.supported, ['numeric']);
  const exit = await runCapability(36, { ...inputs[36], pending: [{ id: 't', dependsOn: ['missing'] }] }, { now });
  assert.equal(exit.result.pending[0].importStatus, 'blocked-missing-context'); assert.equal(exit.result.revocations[0].deletionProven, false);
});

test('unknown write delivery is reviewed rather than silently retried', async () => {
  const result = await runCapability(15, { ...inputs[15], observation: { key: 'wrong', postcondition: true } }, { now });
  assert.equal(result.result.phase, 'human-review'); assert.equal(result.result.externalActionRetried, false);
});

test('policy additions/removals serialize and migration cannot silently compare missing currencies', async () => {
  for (const terms of [{ before: {}, after: { fee: 3 } }, { before: { fee: 3 }, after: {} }]) {
    const output = await runCapability(20, { ...inputs[20], before: { terms: terms.before }, after: { ...inputs[20].after, terms: terms.after } }, { now });
    const alert = output.result.alerts[0];
    assert.equal(Object.hasOwn(alert, 'before'), true); assert.equal(Object.hasOwn(alert, 'after'), true);
    assert.deepEqual(JSON.parse(JSON.stringify(output)), output);
    assert.notEqual(alert.beforePresent, alert.afterPresent);
  }
  const invalid = structuredClone(inputs[24]); delete invalid.source.invoices[0].currency;
  await assert.rejects(runCapability(24, invalid, { now }), /currency/);
});

test('removed research evidence is flagged and effort categories cannot alter object prototypes', async () => {
  const removed = await runCapability(16, { previous: [claim], next: [] }, { now });
  assert.deepEqual(removed.result.alerts[0].reasons, ['evidence-removed']);
  const effort = await runCapability(31, { ...inputs[31], entries: [{ ...inputs[31].entries[0], kind: '__proto__' }] }, { now });
  assert.equal(effort.result.byKind.__proto__, 5);
  assert.deepEqual(JSON.parse(JSON.stringify(effort)), effort);
});
