import { CHECKS, getCheck } from '../shared/checks.js';
import { parseMoney, findAmounts, parseDate, parseLines, splitList, splitPair, sameName } from '../shared/plain.js';
import * as kernels from './checks/kernels.js';
import { verifyObservation, digest } from './checks/verifier.js';

export { CHECKS };
export class CheckInputError extends Error {
  constructor(message) { super(message); this.name = 'CheckInputError'; this.statusCode = 400; }
}
const fail = message => { throw new CheckInputError(message); };
const requireInput = (condition, message) => { if (!condition) fail(message); };
const MAX_ANSWER = 20_000;
const MAX_LINES = 100;

/* Answers are plain text, one per question. The only other thing a check
   may carry is the document Verify picked, which the person never types. */
function readAnswers(check, input) {
  requireInput(input && typeof input === 'object' && !Array.isArray(input), 'Something went wrong reading your answers. Please try again.');
  const known = new Set(check.fields.map(item => item.id));
  const answers = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === 'source' && check.needsSource) continue;
    requireInput(known.has(key), 'These answers belong to a different check. Start the check again.');
    requireInput(value === undefined || value === null || typeof value === 'string', 'Please type your answers as words.');
    requireInput(!value || value.length <= MAX_ANSWER, 'One of your answers is very long. Please shorten it.');
    answers[key] = (value ?? '').trim();
  }
  for (const item of check.fields) {
    answers[item.id] ??= '';
    requireInput(!item.required || answers[item.id], `Please answer “${item.label}”.`);
  }
  return answers;
}
const linesOf = (text, label) => {
  const lines = parseLines(text);
  requireInput(lines.length <= MAX_LINES, `“${label}” has more than ${MAX_LINES} lines. Please keep the most important ones.`);
  return lines;
};
const lineHelp = (label, n, problem, example) => `Line ${n} of “${label}”: ${problem} Try something like “${example}”.`;
const cents = amount => { const value = Math.round(amount * 100); requireInput(Number.isSafeInteger(value), 'That amount is too big to work with.'); return value; };
const money = value => value / 100;
const dateOf = (text, label, now) => {
  if (!text) return null;
  const date = parseDate(text, now);
  requireInput(date, `I couldn’t read the date in “${label}”. Try something like “30 Oct” or “next Friday”.`);
  return date;
};
/* All amounts in one check should be the same money. */
function oneSymbol(found, symbol = null) {
  for (const item of found) if (item?.symbol) {
    requireInput(!symbol || symbol === item.symbol, `Some amounts use ${symbol} and some use ${item.symbol}. Please use one kind of money.`);
    symbol = item.symbol;
  }
  return symbol ?? '';
}

function refund(a, now) {
  const owed = parseMoney(a.owed);
  requireInput(owed && owed.amount > 0, 'I couldn’t find an amount in “How much should you get back?”. Try something like “$49.99”.');
  const label = 'What has come back so far?';
  const payments = linesOf(a.arrived, label).map((line, i) => {
    const found = parseMoney(line);
    requireInput(found && found.amount > 0, lineHelp(label, i + 1, 'I couldn’t find an amount.', '$20 on 3 Oct'));
    return { line, found, waiting: /\b(pending|promised|on (?:its|the) way|expected|will|should|processing)\b/i.test(line) };
  });
  const symbol = oneSymbol([owed, ...payments.map(p => p.found)]);
  const chaseBy = dateOf(a.chaseBy, 'When should you chase it?', now);
  const result = kernels.evaluateConsumerCase(
    { id: 'refund', orderId: 'refund', expectedCents: cents(owed.amount), currency: 'any', followupAt: chaseBy ? `${chaseBy}T23:59:59Z` : '9999-12-31T00:00:00Z' },
    payments.map((p, i) => ({ transactionId: `line-${i + 1}`, source: 'you', orderId: 'refund', currency: 'any', amountCents: cents(p.found.amount), status: p.waiting ? 'promised' : 'settled' })),
    new Date(now).toISOString());
  return { status: result.status, symbol, owed: owed.amount, received: money(result.settledCents), stillOwed: money(result.outstandingCents),
    chaseNow: result.followupDue, chaseBy, waiting: payments.filter(p => p.waiting).map(p => p.line) };
}

function form(a) {
  const questions = linesOf(a.form, 'Paste the form').map(line => {
    const [question, answer] = /:/.test(line) ? splitPair(line) : [line, ''];
    const optional = /\(optional\)/i.test(question) || /\(optional\)/i.test(answer);
    return { question: question.replace(/\s*\(optional\)\s*/i, '').trim(), answer: answer.replace(/\s*\(optional\)\s*/i, '').trim(), optional };
  });
  requireInput(questions.length, 'Please paste at least one question.');
  const fields = questions.map((q, i) => ({ id: `q${i + 1}`, label: q.question, required: !q.optional }));
  const values = Object.fromEntries(questions.map((q, i) => [`q${i + 1}`, q.answer]));
  const reviewed = kernels.transitionForm({ values, errors: {}, reviewed: false }, { type: 'review' }, fields);
  const missing = fields.filter(f => reviewed.errors[f.id]).map(f => f.label);
  const skipped = questions.filter(q => q.optional && !q.answer).map(q => q.question);
  return { status: missing.length ? 'incomplete' : 'complete', missing, skipped, answered: questions.filter(q => q.answer).length, total: questions.length };
}

function groupChoice(a) {
  const label = 'Who’s in, and what works for them?';
  const people = linesOf(a.people, label).map((line, i) => {
    requireInput(/[:=]|\s[-–—]\s/.test(line), lineHelp(label, i + 1, 'put a colon after the name.', 'Ana: Saturday, Friday'));
    const [name, rest] = splitPair(line);
    const picks = splitList(rest);
    requireInput(name && picks.length, lineHelp(label, i + 1, 'say which choices work for them.', 'Ana: Saturday, Friday'));
    return { name, picks };
  });
  requireInput(people.length, 'Please add at least one person.');
  requireInput(new Set(people.map(p => p.name.toLowerCase())).size === people.length, 'Each person should only be listed once.');
  const choices = splitList(a.choices);
  const options = choices.length ? choices : [...new Map(people.flatMap(p => p.picks).map(c => [c.toLowerCase(), c])).values()];
  const match = pick => options.find(option => sameName(option, pick));
  const helped = splitList(a.helped);
  for (const name of helped) requireInput(people.some(p => sameName(p.name, name)), `“${name}” in “Who did more last time?” isn’t one of the people listed.`);
  const members = people.map(person => {
    const acceptable = person.picks.map(pick => { const option = match(pick); requireInput(option, `${person.name} chose “${pick}”, which isn’t one of the choices.`); return option; });
    return { id: person.name, acceptable, costs: Object.fromEntries(acceptable.map((option, rank) => [option, rank])),
      priorBurden: helped.some(name => sameName(name, person.name)) ? 1 : 0 };
  });
  const plan = kernels.choosePlan(members, options, { fairness: 'worst-member' });
  if (plan.status === 'proposed') return { status: 'proposed', choice: plan.option, alsoWorks: plan.alternatives };
  const closest = options.map(option => ({ option, cant: members.filter(m => !m.acceptable.includes(option)).map(m => m.id) }))
    .sort((x, y) => x.cant.length - y.cant.length)[0];
  return { status: 'infeasible', closest: closest?.option ?? null, cant: closest?.cant ?? [] };
}

const YEARLY = /^\s*(?:a|per|\/|each|every)\s*(?:year|yr)\b|^\s*(?:yearly|annually|per annum)\b/i;
const MONTHLY = /^\s*(?:a|per|\/|each|every)\s*(?:month|mo)\b|^\s*monthly\b/i;
function purchase(a) {
  const label = 'What are you choosing between?';
  const items = linesOf(a.options, label).map((line, i) => {
    const amounts = findAmounts(line);
    requireInput(amounts.length, lineHelp(label, i + 1, 'I couldn’t find a price.', 'Laser printer $200, $20 a year'));
    let price = null, yearly = 0;
    for (const item of amounts) {
      const after = line.slice(item.end);
      if (YEARLY.test(after)) yearly += item.amount;
      else if (MONTHLY.test(after)) yearly += item.amount * 12;
      else if (price === null) price = item;
    }
    requireInput(price, lineHelp(label, i + 1, 'I found a yearly cost but no price.', 'Laser printer $200, $20 a year'));
    const name = line.slice(0, amounts[0].index).replace(/[\s,:–—-]+$/, '').trim() || `Option ${i + 1}`;
    return { name, price: price.amount, yearly, found: amounts };
  });
  requireInput(items.length, 'Please add at least one option.');
  const years = a.years ? Number((/(\d+(?:\.\d+)?)/.exec(a.years) || [])[1]) : 3;
  requireInput(Number.isFinite(years) && years >= 0 && years <= 50, 'I couldn’t read how long you’ll keep it. Try something like “3 years”.');
  const budget = a.budget ? parseMoney(a.budget) : null;
  requireInput(!a.budget || budget, 'I couldn’t find an amount in your budget. Try something like “$400”.');
  const symbol = oneSymbol([...items.flatMap(item => item.found), budget]);
  const options = items.map(item => ({ name: item.name, price: item.price, yearly: item.yearly, total: money(cents(item.price + item.yearly * years)) }))
    .map(item => ({ ...item, overBudget: budget ? item.total > budget.amount : false }))
    .sort((x, y) => x.total - y.total || x.name.localeCompare(y.name));
  const fits = options.filter(item => !item.overBudget);
  return { status: fits.length ? 'ranked' : 'none-fit', symbol, years, budget: budget?.amount ?? null, best: fits[0]?.name ?? null, options };
}

function planFix(a) {
  const choices = splitList(a.choices);
  requireInput(choices.length, 'Please list your choices, like “Rome, Lisbon, Porto”.');
  const label = 'What has to be true?';
  const rules = linesOf(a.rules, label).map((line, i) => {
    const flexible = /\(?\s*(?:could skip|optional|nice to have)\s*\)?/i.test(line);
    const cleaned = line.replace(/\(?\s*(?:could skip|optional|nice to have)\s*\)?/ig, '').trim();
    requireInput(/[:=]|\s[-–—]\s/.test(cleaned), lineHelp(label, i + 1, 'put a colon before the choices that pass it.', 'Short flight: Lisbon, Porto'));
    const [rule, rest] = splitPair(cleaned);
    const allowed = splitList(rest).map(pick => {
      const choice = choices.find(c => sameName(c, pick));
      requireInput(choice, lineHelp(label, i + 1, `“${pick}” isn’t one of your choices.`, 'Short flight: Lisbon, Porto'));
      return choice;
    });
    return { id: rule, allowed, mayRelax: flexible };
  });
  requireInput(rules.length && rules.length <= 12, 'Please list between 1 and 12 things that have to be true.');
  requireInput(new Set(rules.map(r => r.id.toLowerCase())).size === rules.length, 'Each thing that has to be true should only be listed once.');
  const result = kernels.permittedRelaxations(choices, rules, 2);
  return { status: result.status, fits: result.options ?? [], giveUp: (result.proposals ?? []).map(item => ({ skip: item.relax, thenFits: item.options })) };
}

function termsChange(a, now) {
  const read = (text, label) => {
    const terms = new Map();
    linesOf(text, label).forEach((line, i) => {
      const [term, value] = splitPair(line);
      requireInput(value, lineHelp(label, i + 1, 'put a colon between the term and what it says.', 'Rent: $1,500'));
      terms.set(term.toLowerCase(), { term, value });
    });
    return terms;
  };
  const before = read(a.before, 'The old terms'), after = read(a.after, 'The new terms');
  const startsOn = dateOf(a.startsOn, 'When do the new terms start?', now);
  const keys = [...new Set([...before.keys(), ...after.keys()])];
  const changes = keys.map(key => ({ term: (after.get(key) ?? before.get(key)).term, before: before.get(key)?.value ?? null, after: after.get(key)?.value ?? null }))
    .filter(item => item.before !== item.after);
  return { status: changes.length ? 'changed' : 'unchanged', startsOn, started: startsOn ? startsOn <= new Date(now).toISOString().slice(0, 10) : null,
    changes, compared: keys.length };
}

/* Balances in cents, then the fewest payments: whoever owes most pays
   whoever is owed most until everyone is even. */
function costSplit(a) {
  const people = splitList(a.people);
  requireInput(people.length >= 2, 'Please add at least two people, like “Ana, Ben”.');
  requireInput(new Set(people.map(p => p.toLowerCase())).size === people.length, 'Each person should only be listed once.');
  const label = 'What did people pay for?';
  const balance = Object.fromEntries(people.map(name => [name, 0])), share = Object.fromEntries(people.map(name => [name, 0]));
  const found = [];
  const words = line => line.toLowerCase().split(/[^\p{L}\p{N}']+/u);
  linesOf(a.spent, label).forEach((line, i) => {
    const inside = /\(([^)]*)\)/.exec(line);
    const outside = line.replace(/\([^)]*\)/, ' ');
    const payer = people.map(name => ({ name, at: words(outside).indexOf(name.toLowerCase()) })).filter(p => p.at >= 0).sort((x, y) => x.at - y.at)[0]?.name;
    requireInput(payer, lineHelp(label, i + 1, 'I couldn’t tell who paid.', `${people[0]} paid $90 for dinner`));
    const amount = parseMoney(outside);
    requireInput(amount && amount.amount > 0, lineHelp(label, i + 1, 'I couldn’t find how much they paid.', `${payer} paid $90 for dinner`));
    found.push(amount);
    const sharers = inside ? splitList(inside[1]).map(name => {
      const person = people.find(p => sameName(p, name));
      requireInput(person, lineHelp(label, i + 1, `“${name}” isn’t one of the people sharing.`, `${payer} paid $10 for a taxi (${people.slice(0, 2).join(', ')})`));
      return person;
    }) : people;
    requireInput(new Set(sharers).size === sharers.length, lineHelp(label, i + 1, 'someone is listed twice in the brackets.', `${payer} paid $10 for a taxi (${people.slice(0, 2).join(', ')})`));
    const total = cents(amount.amount);
    balance[payer] += total;
    const each = Math.floor(total / sharers.length);
    sharers.forEach((person, index) => { const part = each + (index < total - each * sharers.length ? 1 : 0); balance[person] -= part; share[person] += part; });
  });
  requireInput(found.length, 'Please add at least one thing someone paid for.');
  const symbol = oneSymbol(found);
  const owes = people.filter(p => balance[p] < 0).map(p => ({ name: p, cents: -balance[p] })).sort((x, y) => y.cents - x.cents || x.name.localeCompare(y.name));
  const owed = people.filter(p => balance[p] > 0).map(p => ({ name: p, cents: balance[p] })).sort((x, y) => y.cents - x.cents || x.name.localeCompare(y.name));
  const payments = [];
  while (owes.length && owed.length) {
    const amount = Math.min(owes[0].cents, owed[0].cents);
    payments.push({ from: owes[0].name, to: owed[0].name, amount: money(amount) });
    owes[0].cents -= amount; owed[0].cents -= amount;
    if (!owes[0].cents) owes.shift();
    if (!owed[0].cents) owed.shift();
  }
  return { status: payments.length ? 'settle' : 'square', symbol, payments,
    people: people.map(name => ({ name, share: money(share[name]), balance: money(balance[name]) })),
    total: money(found.reduce((sum, item) => sum + cents(item.amount), 0)) };
}

/* The document check's rules, built from plain answers. Only the Verify
   path (native-verification.js) can supply what the document says. */
export function documentContract(answers, resource) {
  const lines = parseLines(answers.mustSay);
  requireInput(lines.length <= MAX_LINES, `Please list at most ${MAX_LINES} things the document must say.`);
  const checks = lines.map((text, i) => ({ id: `says-${i + 1}`, path: ['text'], op: 'contains', expected: text }));
  if (answers.title) checks.push({ id: 'title', path: ['title'], op: 'equals', expected: answers.title });
  requireInput(checks.length, 'Please say what the document must include.');
  return { id: 'document-check', resource, checks };
}

const LIMITS = ['Worked out by Vaelo from what you typed. It didn’t look at your bank, accounts or anyone else’s records.', 'Nothing was sent, paid or changed.'];
const NOTES = {
  refund: 'Only money that has landed counts. Money that is pending or promised isn’t counted yet.',
  'group-choice': 'The first choice each person lists counts as their favourite.',
  purchase: 'Prices are the ones you typed. Check them before you buy.',
};

export async function runCheck(checkId, input, { now = Date.now(), observation } = {}) {
  const check = typeof checkId === 'string' ? getCheck(checkId) : null;
  requireInput(check, 'This check isn’t available any more.');
  const answers = readAnswers(check, input);
  const nowMs = typeof now === 'number' ? now : Date.parse(now);
  requireInput(Number.isFinite(nowMs), 'Something went wrong with the time. Please try again.');
  let result;
  try {
    switch (check.id) {
      case 'document': {
        requireInput(input.source && observation, 'Open the document in a conversation and tap Verify, then run this check.');
        result = verifyObservation(documentContract(answers, observation.resource), observation, { now: nowMs, maxAgeMs: 60000 });
        // The document's own text is referenced by length and digest, never copied once per check.
        const text = observation.state?.text ?? '';
        for (const item of result.checks) if (item.path[0] === 'text' && typeof item.actual === 'string') item.actual = { sourceField: 'text', length: item.actual.length, digest: digest(item.actual) };
        result.evidence.after = { ...observation, state: { title: observation.state?.title, textLength: text.length, textDigest: digest(text) } };
        break;
      }
      case 'refund': result = refund(answers, nowMs); break;
      case 'form': result = form(answers); break;
      case 'group-choice': result = groupChoice(answers); break;
      case 'purchase': result = purchase(answers); break;
      case 'plan-fix': result = planFix(answers); break;
      case 'terms-change': result = termsChange(answers, nowMs); break;
      case 'cost-split': result = costSplit(answers); break;
      default: fail('This check isn’t available any more.');
    }
    const serialized = JSON.stringify(result, (_key, value) => {
      requireInput(typeof value !== 'number' || Number.isFinite(value), 'Those numbers are too big to work with.');
      return value;
    });
    requireInput(serialized.length <= 300000, 'That’s too much to check at once. Please shorten your answers.');
    return { status: 'computed', summary: `${check.title} Worked out from your answers.`, result: JSON.parse(serialized),
      limitations: [...(NOTES[check.id] ? [NOTES[check.id]] : []), ...LIMITS] };
  } catch (error) {
    if (error instanceof CheckInputError) throw error;
    throw new CheckInputError('Those answers couldn’t be checked. Look them over and try again.');
  }
}

