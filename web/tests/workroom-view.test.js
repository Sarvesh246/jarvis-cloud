import test from 'node:test';
import assert from 'node:assert/strict';
import { resultOverview, matchWorkspaces } from '../src/lib/workroom-view.js';
import { WORKSPACES } from '../shared/workspaces.js';

test('every answer reads as a plain sentence, with the person’s own money', () => {
  assert.deepEqual(resultOverview({ status: 'computed', result: {} }), { title: 'Your answer is ready', facts: [] });
  assert.deepEqual(resultOverview({ result: { status: 'partial', symbol: '$', owed: 49.99, received: 20, stillOwed: 29.99, chaseNow: true, chaseBy: '2026-10-10', waiting: ['$5 promised'] } }),
    { title: 'You’re still owed $29.99', facts: ['$20 of $49.99 has come back so far.', 'Not counted yet: “$5 promised”', 'It’s past 10 October 2026. Time to chase it.'] });
  assert.equal(resultOverview({ result: { status: 'resolved', symbol: '£', owed: 10, received: 10, stillOwed: 0 } }).title, 'Your full refund of £10 is back');
  assert.deepEqual(resultOverview({ result: { status: 'incomplete', missing: ['Address'], skipped: ['Phone'], answered: 1, total: 3 } }),
    { title: '1 question is still empty', facts: ['Still empty: Address', 'You can skip: Phone', '1 of 3 answered.'] });
  assert.deepEqual(resultOverview({ result: { status: 'settle', symbol: '€', payments: [{ from: 'Cy', to: 'Ana', amount: 30 }], total: 100 } }),
    { title: '1 payment makes everyone even', facts: ['Cy pays Ana €30', 'Total spent: €100.'] });
});

test('choices, plans, prices, terms and documents each get their own plain answer', () => {
  assert.equal(resultOverview({ result: { status: 'proposed', choice: 'Saturday', alsoWorks: ['Friday'] } }).title, 'Saturday works best for everyone');
  assert.deepEqual(resultOverview({ result: { status: 'infeasible', closest: 'Saturday', cant: ['Ana', 'Ben'] } }).facts, ['Closest: Saturday. Ana and Ben can’t do it.']);
  assert.deepEqual(resultOverview({ result: { status: 'relaxation-proposed', fits: [], giveUp: [{ skip: ['Short flight'], thenFits: ['Rome'] }] } }).facts, ['If you skip “Short flight”, Rome fits.']);
  assert.equal(resultOverview({ result: { status: 'ranked', symbol: '$', years: 3, best: 'Laser', options: [{ name: 'Laser', price: 200, yearly: 20, total: 260, overBudget: false }] } }).facts[0], 'Laser: $260 in total ($200 plus $20 a year)');
  assert.deepEqual(resultOverview({ result: { status: 'changed', changes: [{ term: 'Rent', before: '$1,500', after: '$1,620' }, { term: 'Pets', before: 'no', after: null }], startsOn: '2026-11-01', started: false } }).facts,
    ['Rent: $1,500 → $1,620', 'Gone: Pets (was no)', 'The new terms start on 1 November 2026.']);
  assert.deepEqual(resultOverview({ result: { status: 'partial', says: [{ text: 'Total: $1,200', found: false }, { text: 'Signed by Sam', found: true }] } }),
    { title: '1 thing is missing from your document', facts: ['Missing: Total: $1,200', 'Found: Signed by Sam'] });
});

test('catalogue search matches every word across titles, documents and starters, within an audience', () => {
  assert.deepEqual(matchWorkspaces(WORKSPACES, 'cover letter').map(w => w.id).slice(0, 1), ['job-application']);
  assert.ok(matchWorkspaces(WORKSPACES, 'chargeback').some(w => w.id === 'refund'), 'starters are searchable');
  assert.ok(matchWorkspaces(WORKSPACES, '', 'code').every(w => w.audience === 'code'));
  for (const word of ['resume', 'résumé', 'Resume', 'cv', 'job'])
    assert.ok(matchWorkspaces(WORKSPACES, word).some(w => w.id === 'job-application'), `“${word}” finds the job workspace`);
  assert.deepEqual(matchWorkspaces(WORKSPACES, 'zzzz'), []);
  assert.equal(matchWorkspaces(WORKSPACES).length, WORKSPACES.length);
});
