import test from 'node:test';
import assert from 'node:assert/strict';
import { runCheck, CheckInputError, CHECKS } from '../server/check-engine.js';
import { blankAnswers, missingAnswers } from '../shared/checks.js';

const now = Date.parse('2026-10-15T15:00:00Z');
export const checkAnswers = {
  refund: { owed: '$49.99', arrived: '$20 on 3 Oct\n$29.99 promised by email', chaseBy: '10 Oct' },
  form: { form: 'Name: Sam\nAddress:\nPhone (optional):' },
  'group-choice': { people: 'Ana: Saturday, Friday\nBen: Saturday, Friday' },
  purchase: { options: 'Laser printer $200, $20 a year\nInkjet $80, $8 a month', years: '3 years', budget: '$300' },
  'plan-fix': { choices: 'Rome, Lisbon', rules: 'Short flight: Lisbon (could skip)\nBeach: Rome' },
  'terms-change': { before: 'Rent: $1,500\nNotice: 2 months\nPets: no', after: 'Rent: $1,620\nNotice: 2 months', startsOn: '1 Nov' },
  'cost-split': { people: 'Ana, Ben and Cy', spent: 'Ana paid $90 for dinner\nBen paid $10.01 for a taxi (Ana, Ben)' },
};

test('every check asks only plain questions, and none of them is technical', () => {
  for (const check of CHECKS) {
    assert.ok(check.title && check.description && check.fields.length);
    for (const field of check.fields) {
      assert.ok(['money', 'date', 'text', 'list', 'lines', 'paste'].includes(field.kind), `${check.id}.${field.id}`);
      assert.ok(field.label && field.hint, `${check.id}.${field.id} has a label and an example`);
      assert.doesNotMatch(`${field.label} ${field.hint}`, /\b(ID|JSON|ISO|schema|field|cents|enum|resource|contract|revision|timestamp|map)\b/, `${check.id}.${field.id} avoids jargon`);
    }
    assert.deepEqual(Object.values(blankAnswers(check)).every(value => value === ''), true);
  }
  assert.deepEqual(missingAnswers(CHECKS.find(c => c.id === 'refund'), { owed: ' ' }), ['How much should you get back?']);
});

test('every check works from everyday answers, the same way each time, without changing them', async () => {
  for (const [id, answers] of Object.entries(checkAnswers)) {
    const original = structuredClone(answers);
    const output = await runCheck(id, answers, { now });
    assert.equal(output.status, 'computed', id); assert.ok(output.result && output.limitations.length);
    assert.deepEqual(answers, original);
    assert.deepEqual(await runCheck(id, answers, { now }), output, `Same answer every time: ${id}`);
  }
});

test('a refund counts only money that has landed and says when to chase', async () => {
  const { result } = await runCheck('refund', checkAnswers.refund, { now });
  assert.deepEqual(result, { status: 'partial', symbol: '$', owed: 49.99, received: 20, stillOwed: 29.99, chaseNow: true, chaseBy: '2026-10-10', waiting: ['$29.99 promised by email'] });
  const done = await runCheck('refund', { owed: '50 dollars', arrived: '- $25\n- $25' }, { now });
  assert.equal(done.result.status, 'resolved', 'two payments of the same amount both count');
  assert.equal((await runCheck('refund', { owed: '£10' }, { now })).result.status, 'unresolved');
  await assert.rejects(runCheck('refund', { owed: '$10', arrived: '£5' }, { now }), /one kind of money/);
});

test('a form lists empty questions in plain words and never sends anything', async () => {
  const { result } = await runCheck('form', checkAnswers.form, { now });
  assert.deepEqual(result, { status: 'incomplete', missing: ['Address'], skipped: ['Phone'], answered: 1, total: 3 });
  assert.equal((await runCheck('form', { form: 'Name: Sam' }, { now })).result.status, 'complete');
});

test('a group choice uses favourites first and gives people who did more an easier pick', async () => {
  assert.equal((await runCheck('group-choice', checkAnswers['group-choice'], { now })).result.choice, 'Saturday');
  const split = { people: 'Ana: Saturday, Friday\nBen: Friday, Saturday' };
  assert.equal((await runCheck('group-choice', split, { now })).result.choice, 'Friday', 'a tie falls back to alphabetical order');
  assert.equal((await runCheck('group-choice', { ...split, helped: 'Ana' }, { now })).result.choice, 'Saturday', 'Ana did more last time, so she gets her favourite');
  const stuck = await runCheck('group-choice', { people: 'Ana: Friday\nBen: Saturday\nCy: Saturday' }, { now });
  assert.deepEqual(stuck.result, { status: 'infeasible', closest: 'Saturday', cant: ['Ana'] });
  await assert.rejects(runCheck('group-choice', { people: 'Ana Saturday' }, { now }), /put a colon after the name/);
  await assert.rejects(runCheck('group-choice', { people: 'Ana: Sunday', choices: 'Friday, Saturday' }, { now }), /isn’t one of the choices/);
});

test('buying compares price plus yearly or monthly costs against the budget', async () => {
  const { result } = await runCheck('purchase', checkAnswers.purchase, { now });
  assert.equal(result.best, 'Laser printer'); assert.equal(result.symbol, '$');
  assert.deepEqual(result.options.map(o => [o.name, o.total, o.overBudget]), [['Laser printer', 260, false], ['Inkjet', 368, true]]);
  assert.equal((await runCheck('purchase', { options: 'Kettle $30' }, { now })).result.years, 3, 'three years when not said');
  await assert.rejects(runCheck('purchase', { options: 'A nice kettle' }, { now }), /Line 1 .* couldn’t find a price/);
});

test('plans say what to skip, and term changes show added, changed and removed terms', async () => {
  const plan = await runCheck('plan-fix', checkAnswers['plan-fix'], { now });
  assert.deepEqual(plan.result, { status: 'relaxation-proposed', fits: [], giveUp: [{ skip: ['Short flight'], thenFits: ['Rome'] }] });
  await assert.rejects(runCheck('plan-fix', { choices: 'Rome', rules: 'Beach: Paris' }, { now }), /isn’t one of your choices/);
  const terms = await runCheck('terms-change', checkAnswers['terms-change'], { now });
  assert.deepEqual(terms.result.changes, [{ term: 'Rent', before: '$1,500', after: '$1,620' }, { term: 'Pets', before: 'no', after: null }]);
  assert.equal(terms.result.startsOn, '2026-11-01'); assert.equal(terms.result.started, false);
});

test('sharing costs balances to the cent and settles in the fewest payments', async () => {
  const { result } = await runCheck('cost-split', checkAnswers['cost-split'], { now });
  assert.equal(result.symbol, '$'); assert.equal(result.total, 100.01);
  assert.equal(Math.round(result.people.reduce((sum, p) => sum + p.balance, 0) * 100), 0);
  assert.deepEqual(result.payments, [{ from: 'Cy', to: 'Ana', amount: 30 }, { from: 'Ben', to: 'Ana', amount: 24.99 }]);
  await assert.rejects(runCheck('cost-split', { people: 'Ana, Ben', spent: 'Dee paid $5 for snacks' }, { now }), /couldn’t tell who paid/);
  await assert.rejects(runCheck('cost-split', { people: 'Ana, Ben', spent: 'Ana paid $5 (Ana, Zed)' }, { now }), /“Zed” isn’t one of the people/);
});

test('mistakes get a friendly sentence that says what to do next', async () => {
  for (const [id, answers, message] of [
    ['missing', {}, /isn’t available/],
    ['refund', {}, /Please answer “How much should you get back\?”/],
    ['refund', { owed: 'lots' }, /Try something like “\$49\.99”/],
    ['refund', { owed: '$5', chaseBy: 'whenever' }, /couldn’t read the date .* “30 Oct”/],
    ['form', { form: 'x', extra: 'y' }, /different check/],
    ['form', { form: { question: 'Name' } }, /type your answers as words/],
    ['form', { form: 'x'.repeat(20_001) }, /very long/],
  ]) {
    await assert.rejects(runCheck(id, answers, { now }), error => error instanceof CheckInputError && error.statusCode === 400 && message.test(error.message), `${id}: ${message}`);
  }
});

test('the document check only runs on a document Verify picked', async () => {
  await assert.rejects(runCheck('document', { mustSay: 'Total: $1,200' }, { now }), /tap Verify/);
});
