import test from 'node:test';
import assert from 'node:assert/strict';
import { runCheck, CheckInputError } from '../server/check-engine.js';
import { getCheck } from '../shared/checks.js';
import { parseDate } from '../shared/plain.js';
import { resultOverview } from '../src/lib/workroom-view.js';

const now = Date.parse('2026-10-15T15:00:00Z');
const compare = async input => (await runCheck('terms-change', input, { now })).result;
const duplicate = (label, line, term) => error =>
  error instanceof CheckInputError && error.statusCode === 400 &&
  error.message.includes(`Line ${line} of “${label}”`) &&
  error.message.includes(`“${term}”`) && /only once/.test(error.message);

test('conflicting old terms cannot disappear into a false unchanged result', async () => {
  await assert.rejects(compare({ before: 'Rent: $1,500\nrent: $1,000', after: 'Rent: $1,000' }),
    duplicate('The old terms', 2, 'rent'));
});

test('conflicting new terms cannot hide a change or replace an earlier value', async () => {
  for (const after of ['Rent: $1,620\nRENT: $1,500', 'Rent: $1,500\nRENT: $1,620']) {
    await assert.rejects(compare({ before: 'Rent: $1,500', after }), duplicate('The new terms', 2, 'RENT'));
  }
});

test('repeated equal values still require one entry for each term on each side', async () => {
  for (const side of ['before', 'after']) {
    await assert.rejects(compare({ before: 'Notice: 2 months', after: 'Notice: 2 months',
      [side]: 'Notice: 2 months\nNotice: 2 months' }),
    duplicate(side === 'before' ? 'The old terms' : 'The new terms', 2, 'Notice'));
  }
});

test('duplicate admission uses existing case and whitespace matching for every separator', async () => {
  for (const name of ['Rent', 'Échéance', 'Διάρκεια', '__proto__', 'constructor']) {
    for (const separator of [': ', ' = ', ' — ', ' – ', ' - ']) {
      await assert.rejects(compare({ before: 'Other: unchanged',
        after: `- Other: unchanged\n2. ${name}: first\n\n • \u00a0${name.toUpperCase()}\u00a0${separator}second` }),
      duplicate('The new terms', 3, name.toUpperCase()));
    }
  }
});

test('unique terms preserve exact values, authored ordering and safe property names', async () => {
  const input = {
    before: 'Rent: $1,500\nNotice: 2 months\nPets: no\n__proto__: original\nconstructor: same\nÉchéance: bientôt',
    after: 'RENT = $1,620\nnotice — 2 months\n__proto__: updated\nconstructor: same\nÉCHÉANCE: bientôt\nParking: included: space 2',
    startsOn: '1 Nov',
  };
  const original = structuredClone(input);
  const output = await runCheck('terms-change', input, { now });
  assert.deepEqual(output.result, { status: 'changed', startsOn: '2026-11-01', started: false, compared: 7,
    changes: [
      { term: 'RENT', before: '$1,500', after: '$1,620' },
      { term: 'Pets', before: 'no', after: null },
      { term: '__proto__', before: 'original', after: 'updated' },
      { term: 'Parking', before: null, after: 'included: space 2' },
    ] });
  assert.deepEqual(input, original);
  assert.deepEqual(await runCheck('terms-change', input, { now }), output);
  assert.deepEqual(resultOverview(output), { title: '4 things changed', facts: [
    'RENT: $1,500 → $1,620', 'Gone: Pets (was no)', '__proto__: original → updated',
    'New: Parking is included: space 2', 'The new terms start on 1 November 2026.',
  ] });
});

test('the same term on opposite sides is valid and value differences stay literal', async () => {
  const unchanged = await compare({ before: 'Rent: $1,500', after: 'RENT: $1,500' });
  assert.deepEqual(unchanged, { status: 'unchanged', startsOn: null, started: null, changes: [], compared: 1 });
  assert.equal(resultOverview({ result: unchanged }).title, 'Nothing changed');
  const result = await compare({ before: 'Access: YES\nNotes: **source** | x\\y 😀',
    after: 'Access: yes\nNotes: **source** | x\\y 😀\nAccess hours: 09:00–17:00' });
  assert.deepEqual(result.changes, [
    { term: 'Access', before: 'YES', after: 'yes' },
    { term: 'Access hours', before: null, after: '09:00–17:00' },
  ]);
});

test('every suggested start-date example is accepted by the preview and check', async () => {
  const hint = getCheck('terms-change').fields.find(field => field.id === 'startsOn').hint;
  const examples = [...hint.matchAll(/“([^”]+)”/g)].map(match => match[1]);
  assert.ok(examples.length >= 2);
  for (const example of examples) {
    const date = parseDate(example, now);
    assert.ok(date, `the date hint must work: ${example}`);
    const result = await compare({ before: 'Rent: $1,500', after: 'Rent: $1,620', startsOn: example });
    assert.equal(result.startsOn, date);
    assert.equal(result.started, date <= '2026-10-15');
  }
});

test('term comparison keeps existing date, malformed-line and size boundaries', async () => {
  for (const [startsOn, expected] of [['today', true], ['yesterday', true], ['tomorrow', false], ['31/12/2026', false]]) {
    assert.equal((await compare({ before: 'Fee: $10', after: 'Fee: $20', startsOn })).started, expected);
  }
  for (const startsOn of ['31 Feb', '2026-13-01', 'next month']) {
    await assert.rejects(compare({ before: 'Fee: $10', after: 'Fee: $20', startsOn }), /couldn’t read the date/);
  }
  await assert.rejects(compare({ before: 'Fee: $10', after: 'Fee without a value' }), /Line 1 of “The new terms”/);
  await assert.rejects(compare({ before: 'Fee: $10', after: 'Fee: ' }), /Line 1 of “The new terms”/);
  const lines = Array.from({ length: 100 }, (_, i) => `Term ${i}: ${i}`).join('\r\n');
  assert.equal((await compare({ before: lines, after: lines })).compared, 100);
  await assert.rejects(compare({ before: lines, after: `${lines}\nExtra: value` }), /more than 100 lines/);
  await assert.rejects(compare({ before: 'Fee: $10', after: 'x'.repeat(20_001) }), /very long/);
});
