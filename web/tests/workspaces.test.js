import test from 'node:test';
import assert from 'node:assert/strict';
import { WORKSPACES, AUDIENCES, getWorkspace } from '../shared/workspaces.js';
import { CHECKS, getCheck, checkForLegacy } from '../shared/checks.js';
import { WORK_LIMITS, upgradeRecord, workspaceFor, allocate, excerpt, contextPlan } from '../shared/work-records.js';

test('the catalogue is broad: 25 to 40 workspaces covering every audience', () => {
  assert.ok(WORKSPACES.length >= 25 && WORKSPACES.length <= 40, `${WORKSPACES.length} workspaces`);
  for (const audience of AUDIENCES) assert.ok(WORKSPACES.filter(w => w.audience === audience.id).length >= 2, `${audience.label} has at least two`);
  assert.equal(new Set(WORKSPACES.map(w => w.id)).size, WORKSPACES.length);
  assert.equal(new Set(WORKSPACES.map(w => w.title)).size, WORKSPACES.length);
});

test('every workspace is complete enough to start work without writing a prompt', () => {
  const audiences = new Set(AUDIENCES.map(a => a.id));
  for (const w of WORKSPACES) {
    assert.match(w.id, /^[a-z0-9-]+$/, w.id); assert.ok(!['custom', 'retired'].includes(w.id));
    assert.ok(audiences.has(w.audience), `${w.id} audience`);
    assert.ok(w.title.length <= 60 && w.summary.length <= 120, `${w.id} title and summary are short`);
    assert.ok(w.brief.length >= 300 && w.brief.length <= WORK_LIMITS.brief, `${w.id} brief length ${w.brief.length}`);
    assert.match(w.brief, /never|don't|do not|not /i, `${w.id} brief says what not to invent or do`);
    assert.ok(w.starters.length >= 3 && w.starters.length <= 5, `${w.id} has 3-5 starters`);
    assert.ok(w.starters.every(s => s.length <= WORK_LIMITS.starterChars));
    assert.ok(w.slots.length <= WORK_LIMITS.documents - 1, `${w.id} leaves room for extra documents`);
    assert.equal(new Set(w.slots.map(s => s.id)).size, w.slots.length);
    for (const slot of w.slots) {
      assert.match(slot.id, /^[a-zA-Z0-9_-]{1,60}$/); assert.notEqual(slot.id, 'extra');
      assert.ok(slot.label && slot.hint && typeof slot.required === 'boolean', `${w.id}.${slot.id}`);
    }
    if (w.check) assert.ok(getCheck(w.check), `${w.id} check ${w.check} exists`);
  }
});

test('every surviving check is offered by at least one workspace', () => {
  for (const check of CHECKS) assert.ok(WORKSPACES.some(w => w.check === check.id), `${check.id} is reachable`);
});

test('only checks that survived the audit map from the old numbered tools', () => {
  const surviving = [1, 3, 4, 9, 12, 19, 20, 33];
  for (let id = 1; id <= 36; id++) assert.equal(Boolean(checkForLegacy(id)), surviving.includes(id), `capability ${id}`);
  assert.equal(checkForLegacy(9).id, 'group-choice'); assert.equal(checkForLegacy(33).id, 'group-choice');
});

test('upgrading leaves new records alone, migrates surviving inputs and retires the rest', () => {
  const current = { id: 'a', workspaceId: 'debug', title: 'Bug' };
  assert.equal(upgradeRecord(current), current);
  assert.equal(upgradeRecord({ id: 'x', deleted: true }).deleted, true);
  const plan = upgradeRecord({ id: 'p', capabilityId: 19, title: 'Trip', input: { options: ['a', 'b'], constraints: [{ id: 'cheap', allowed: ['a'], mayRelax: true }], maxRelaxed: 1 } });
  assert.deepEqual(plan.check, { id: 'plan-fix', input: { choices: 'a, b', rules: 'cheap: a (could skip)' } }, 'old answers come back as plain words');
  assert.equal(plan.workspaceId, 'decision'); assert.equal(plan.capabilityId, undefined);
  const terms = upgradeRecord({ id: 't', capabilityId: 20, title: 'Terms', input: { before: { terms: { fee: 1 } }, after: { id: 'p', version: '2', effectiveAt: '2026-11-15T15:00:00Z', terms: { fee: 2 } }, watchFields: ['fee'] } });
  assert.deepEqual(terms.check.input, { before: 'fee: 1', after: 'fee: 2', startsOn: '2026-11-15' });
  const group = upgradeRecord({ id: 'g', capabilityId: 33, title: 'Chores', input: { members: [{ id: 'a', acceptable: ['x'], costs: { x: 1 }, priorBurden: 2 }], options: ['x'], fairness: 'total' } });
  assert.deepEqual(group.check.input, { choices: 'x', people: 'a: x', helped: 'a' });
  const retired = upgradeRecord({ id: 'r', capabilityId: 27, title: 'Models', input: { task: 'x' }, output: { status: 'computed' } });
  assert.equal(retired.workspaceId, 'retired'); assert.deepEqual(retired.legacy, { capabilityId: 27, input: { task: 'x' }, output: { status: 'computed' } });
  assert.equal(workspaceFor(retired).retired, true);
  assert.equal(workspaceFor({ workspaceId: 'custom', title: 'Mine', brief: 'Do it', starters: ['Go'] }).brief, 'Do it');
  assert.equal(workspaceFor({ workspaceId: 'job-application' }), getWorkspace('job-application'));
});

test('the context budget keeps short documents whole and shares the rest', () => {
  assert.deepEqual(allocate([100, 5000, 20000], 9000), [100, 4450, 4450]);
  assert.deepEqual(allocate([10, 20], 1000), [10, 20]);
  assert.deepEqual(allocate([0, 50], 10), [0, 10]);
  const text = 'Start ' + 'm'.repeat(5000) + ' End';
  const cut = excerpt(text, 1000);
  assert.ok(cut.length <= 1000); assert.ok(cut.startsWith('Start')); assert.ok(cut.endsWith('End')); assert.match(cut, /left out to fit/);
  assert.equal(excerpt('short', 1000), 'short');
  const plan = contextPlan({ brief: 'b'.repeat(1000), notes: 'n', documents: [{ chars: 200_000 }, { chars: 2_000 }] });
  assert.equal(plan.trimmed, true); assert.equal(plan.documents[1].trimmed, false); assert.ok(plan.documents[0].keep < 200_000);
  assert.equal(contextPlan({ documents: [{ chars: 1000 }] }).trimmed, false);
});

test('what people read in the catalogue avoids jargon outside the developer shelf', () => {
  const jargon = /\b(CSV|EOB|JSON|FAQs?|IDs?|criteria|conventions|itinerary|transcript|rubric|clauses?|repurpos\w*|evidenced|syllabus|deductions|export)\b/i;
  for (const w of WORKSPACES.filter(item => item.audience !== 'code')) {
    for (const text of [w.title, w.summary, ...w.starters, ...w.slots.flatMap(s => [s.label, s.hint])])
      assert.doesNotMatch(text, jargon, `${w.id}: “${text}”`);
  }
  for (const a of AUDIENCES) assert.doesNotMatch(`${a.label} ${a.line}`, jargon, a.id);
});
