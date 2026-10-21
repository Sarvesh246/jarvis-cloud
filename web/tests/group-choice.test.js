import test from 'node:test';
import assert from 'node:assert/strict';
import { runCheck, CheckInputError } from '../server/check-engine.js';

const calculate = input => runCheck('group-choice', input);
const invalid = pattern => error => error instanceof CheckInputError && error.statusCode === 400 && pattern.test(error.message);

test('group choices reject repeated preferences instead of overwriting a favorite rank', async () => {
  // Without validation the last Friday overwrites rank zero with rank two,
  // making Saturday win even though both people put Friday first.
  await assert.rejects(calculate({ people: 'Ana: Friday, Saturday, Friday\nBen: Friday, Saturday' }),
    invalid(/Line 1.*Friday.*listed.*once/));
  assert.equal((await calculate({ people: 'Ana: Friday, Saturday\nBen: Friday, Saturday' })).result.choice, 'Friday');
});

test('group duplicate preference validation uses the same case and whitespace matching as choices', async () => {
  for (const people of [
    'Ana: Friday, friday',
    'Ana: Friday, Saturday\nBen: Saturday; FRIDAY; saturday',
    'Élodie: Café, Park, CAFÉ',
    'Ana: Friday / Saturday / Friday',
    'Ana: Friday and Saturday and Friday',
  ]) await assert.rejects(calculate({ people }), invalid(/Line [12].*listed.*once/), people);
});

test('explicit group choices reject duplicate identities instead of repeated alternatives', async () => {
  for (const choices of ['Friday, Friday', ' Friday ; FRIDAY ', 'Café\nCAFÉ']) {
    const pick = /caf/i.test(choices) ? 'Café' : 'Friday';
    await assert.rejects(calculate({ people: `Ana: ${pick}`, choices }), invalid(/choices.*listed.*once/i), choices);
  }
});

test('duplicate explicit choices do not falsely exhaust the unique option limit', async () => {
  await assert.rejects(calculate({ people: 'Ana: Friday', choices: Array(101).fill('Friday').join(', ') }),
    invalid(/choices.*listed.*once/i));
});

test('group ranks keep canonical choice spelling, Unicode names and prior effort', async () => {
  const input = { people: 'Élodie: café, PARK\n李: park, Café', choices: 'Café, Park', helped: 'ÉLODIE' };
  const original = structuredClone(input);
  const output = await calculate(input);
  assert.deepEqual(output.result, { status: 'proposed', choice: 'Café', alsoWorks: ['Park'] });
  assert.deepEqual(input, original);
  assert.deepEqual(await calculate(input), output);
  assert.match(output.limitations[0], /first choice.*favorite/);
});

test('group choice bounds distinguish large searches from infeasibility and admit 100 options', async () => {
  const options = Array.from({ length: 100 }, (_, i) => `Option ${String(i).padStart(3, '0')}`);
  const people = `Ana: ${options.join(', ')}\nBen: ${options.join(', ')}`;
  const output = await calculate({ people, choices: options.join(', ') });
  assert.equal(output.result.choice, options[0]);
  assert.equal(output.result.alsoWorks.length, 99);
  const tooMany = options.concat('Extra').join(', ');
  for (const input of [
    { people, choices: tooMany },
    { people: `Ana: ${tooMany}` },
  ]) await assert.rejects(calculate(input), invalid(/100 or fewer/));
  assert.deepEqual((await calculate({ people: 'Ana: Friday\nBen: Saturday\nCy: Saturday' })).result,
    { status: 'infeasible', closest: 'Saturday', cant: ['Ana'] });
});

test('group option identities remain safe as object property names', async () => {
  assert.deepEqual((await calculate({ people: 'Ana: __proto__, constructor, toString\nBen: __proto__, constructor, toString' })).result,
    { status: 'proposed', choice: '__proto__', alsoWorks: ['constructor', 'toString'] });
});

test('group decisions match an independent worst-burden oracle across ranked profiles', async () => {
  const options = ['Friday', 'Saturday', 'Sunday'];
  const profiles = [
    ['Friday'], ['Saturday'], ['Sunday'],
    ['Friday', 'Saturday'], ['Saturday', 'Friday'],
    ['Friday', 'Sunday', 'Saturday'], ['Sunday', 'Saturday', 'Friday'],
  ];
  for (const ana of profiles) for (const ben of profiles) for (const cy of profiles) {
    const rankings = [ana, ben, cy];
    for (const helped of ['', 'Ana', 'Ben, Cy']) {
      const prior = helped === 'Ana' ? [1, 0, 0] : helped ? [0, 1, 1] : [0, 0, 0];
      const names = ['Ana', 'Ben', 'Cy'];
      const feasible = options.filter(option => rankings.every(picks => picks.includes(option)));
      feasible.sort((a, b) => {
        const score = option => Math.max(...rankings.map((picks, i) => picks.indexOf(option) + prior[i]));
        return score(a) - score(b) || a.localeCompare(b);
      });
      const { result } = await calculate({
        people: rankings.map((picks, i) => `${names[i]}: ${picks.join(', ')}`).join('\n'),
        choices: options.join(', '), helped,
      });
      if (feasible.length) assert.deepEqual(result, { status: 'proposed', choice: feasible[0], alsoWorks: feasible.slice(1) });
      else {
        assert.equal(result.status, 'infeasible');
        const cant = names.filter((_, i) => !rankings[i].includes(result.closest));
        assert.deepEqual(result.cant, cant);
        assert.equal(cant.length, Math.min(...options.map(option => rankings.filter(picks => !picks.includes(option)).length)));
      }
    }
  }
});
