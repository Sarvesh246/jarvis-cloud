import test from 'node:test';
import assert from 'node:assert/strict';
import { runCheck, CheckInputError } from '../server/check-engine.js';

const now = Date.parse('2026-10-21T06:00:00Z');
const split = async answers => (await runCheck('cost-split', answers, { now })).result;

test('empty explicit sharing lists cannot report an unsettled expense as square', async () => {
  for (const list of ['', ' ', ', ; / &']) {
    await assert.rejects(split({ people: 'Ana, Ben', spent: `Ana paid $10 (${list})` }),
      error => error instanceof CheckInputError && error.statusCode === 400 && /at least one person/i.test(error.message));
  }
  const result = await split({ people: 'Ana, Ben', spent: 'Ana paid $10' });
  assert.deepEqual(result.payments, [{ from: 'Ben', to: 'Ana', amount: 5 }]);
  assert.equal(result.total, 10);
});

test('payers can have full, hyphenated, apostrophe and Unicode names', async () => {
  for (const payer of ['Ana Smith', 'Mary-Jane', "O'Neil", '李 明', 'Élodie Martin']) {
    const result = await split({ people: `${payer}, Ben Jones`, spent: `${payer.toUpperCase()} paid $10 (${payer}, Ben Jones)` });
    assert.deepEqual(result.payments, [{ from: 'Ben Jones', to: payer, amount: 5 }], payer);
    assert.deepEqual(result.people.map(person => person.balance), [5, -5]);
  }
});

test('a full payer name wins over a shorter name at the same position', async () => {
  const result = await split({ people: 'Ana, Ana Smith, Ben', spent: 'Ana Smith paid $12' });
  assert.deepEqual(result.payments, [
    { from: 'Ana', to: 'Ana Smith', amount: 4 },
    { from: 'Ben', to: 'Ana Smith', amount: 4 },
  ]);
  const reversed = await split({ people: 'Ana Smith, Ana, Ben', spent: 'Ana paid $12 for Ana Smith' });
  assert.equal(reversed.people.find(person => person.name === 'Ana').balance, 8, 'earliest person remains the payer');
  await assert.rejects(split({ people: 'Ana, Ben', spent: 'Banana paid $12' }), /couldn’t tell who paid/);
});

test('payer matching preserves punctuation that distinguishes participants', async () => {
  const result = await split({ people: 'Mary Jane, Mary-Jane, Ben', spent: 'Mary-Jane paid $12' });
  assert.equal(result.people.find(person => person.name === 'Mary-Jane').balance, 8);
  assert.equal(result.people.find(person => person.name === 'Mary Jane').balance, -4);
  const escaped = await split({ people: 'Ana [A], Ben', spent: 'Ana [A] paid $10' });
  assert.equal(escaped.people[0].balance, 5, 'names are literal text, not regular expressions');
  const spaced = await split({ people: 'Ana Smith, Ben', spent: 'Ana   Smith paid $10' });
  assert.equal(spaced.people[0].balance, 5);
});

test('combined expenses stay within the safe integer cent budget', async () => {
  await assert.rejects(split({ people: 'Ana, Ben', spent: 'Ana paid $90000000000000\nBen paid $90000000000000' }),
    error => error instanceof CheckInputError && error.statusCode === 400 && /too big/i.test(error.message));
  const result = await split({ people: 'Ana, Ben', spent: 'Ana paid $40000000000000\nBen paid $40000000000000' });
  assert.equal(result.total, 80000000000000);
  assert.equal(result.status, 'square');
});

test('settlements conserve every cent for uneven shares and repeated expenses', async () => {
  for (let size = 2; size <= 12; size += 1) {
    const names = Array.from({ length: size }, (_, i) => `Person ${i + 1}`);
    const spent = [];
    let total = 0;
    for (let i = 0; i < 25; i += 1) {
      const cents = (i * 137 + size * 43) % 10001 + 1;
      total += cents;
      const sharers = names.filter((_, index) => (index + i) % 3 !== 0);
      spent.push(`${names[i % size]} paid $${(cents / 100).toFixed(2)} (${sharers.join(', ')})`);
    }
    const answers = { people: names.join(', '), spent: spent.join('\n') };
    const original = structuredClone(answers);
    const result = await split(answers);
    const toCents = amount => Math.round(amount * 100);
    assert.equal(toCents(result.total), total);
    assert.equal(result.people.reduce((sum, p) => sum + toCents(p.share), 0), total);
    assert.equal(result.people.reduce((sum, p) => sum + toCents(p.balance), 0), 0);
    const balances = new Map(result.people.map(p => [p.name, toCents(p.balance)]));
    for (const payment of result.payments) {
      assert.ok(payment.amount > 0);
      balances.set(payment.from, balances.get(payment.from) + toCents(payment.amount));
      balances.set(payment.to, balances.get(payment.to) - toCents(payment.amount));
    }
    assert.ok([...balances.values()].every(value => value === 0), `all ${size} people settle exactly`);
    assert.deepEqual(answers, original);
    assert.deepEqual(await split(answers), result);
  }
});
