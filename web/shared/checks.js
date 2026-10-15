// Checks a workspace can work out with code from a few plain answers. Every
// answer is everyday text ("$40", "next Friday", one item per line); the
// server reads it with shared/plain.js, so nobody types an ID, a date format
// or a data structure. The model never computes the result.
//
// Field kinds: money, date, text (one line), list ("Ana, Ben"), lines (a box
// with one thing per line), paste (a box for pasted text).
const field = (id, kind, label, hint, required = false) => ({ id, kind, label, hint, required });

const definitions = [
  {
    id: 'document', legacyId: 1, title: 'Does my document say the right things?',
    description: 'Vaelo reads your saved document again and checks each thing you list is in it.',
    // The document itself is chosen by tapping Verify on it, never typed in.
    fields: [
      field('mustSay', 'lines', 'What must it say?', 'One thing per line. For example: “Total: $1,200” or “Signed by Sam”.', true),
      field('title', 'text', 'What should the title be?', 'Leave this empty if the title doesn’t matter.'),
    ],
    needsSource: true,
  },
  {
    id: 'refund', legacyId: 3, title: 'Has my refund come back?',
    description: 'Add up the money that has really come back, and see how much is still missing.',
    fields: [
      field('owed', 'money', 'How much should you get back?', 'For example: $49.99', true),
      field('arrived', 'lines', 'What has come back so far?', 'One payment per line, like “$20 on 3 Oct”. Write “pending” or “promised” next to money that hasn’t landed yet. Leave it empty if nothing has come.'),
      field('chaseBy', 'date', 'When should you chase it?', 'Any date works, like “next Friday” or “30 Oct”.'),
    ],
  },
  {
    id: 'form', legacyId: 4, title: 'Have I filled everything in?',
    description: 'Paste the questions with your answers and see which ones are still empty. Nothing gets sent.',
    fields: [
      field('form', 'paste', 'Paste the form', 'One question per line, with your answer after a colon. Like “Name: Sam”, or “Address:” if it’s still empty. Write “(optional)” after questions you can skip.', true),
    ],
  },
  {
    id: 'group-choice', legacyId: [9, 33], title: 'What works for everyone?',
    description: 'Say what works for each person. Vaelo finds the choice that is fairest to everyone.',
    fields: [
      field('people', 'lines', 'Who’s in, and what works for them?', 'One person per line, favourite first. Like “Ana: Saturday, Friday”.', true),
      field('choices', 'list', 'What are all the choices?', 'Optional. Like “Friday, Saturday, Sunday”. If you leave it empty, Vaelo uses the ones above.'),
      field('helped', 'list', 'Who did more last time?', 'Optional. Their names, like “Ben”. They get an easier pick this time.'),
    ],
  },
  {
    id: 'purchase', legacyId: 12, title: 'Which one costs least over time?',
    description: 'Compare what each option really costs once yearly costs are added, and what fits your budget.',
    fields: [
      field('options', 'lines', 'What are you choosing between?', 'One per line, with the price and any yearly cost. Like “Laser printer $200, $20 a year”.', true),
      field('years', 'text', 'How long will you keep it?', 'Like “3 years”. If you leave it empty, Vaelo uses 3.'),
      field('budget', 'money', 'What can you spend in total?', 'Optional. Like “$400”, including the yearly costs.'),
    ],
  },
  {
    id: 'plan-fix', legacyId: 19, title: 'Why won’t my plan fit?',
    description: 'List your choices and the things that must be true. If nothing fits, see the fewest things to give up.',
    fields: [
      field('choices', 'list', 'What are the choices?', 'Like “Rome, Lisbon, Porto”.', true),
      field('rules', 'lines', 'What has to be true?', 'One per line, then the choices that pass it. Add “(could skip)” if you could live without it. Like “Short flight: Lisbon, Porto (could skip)”.', true),
    ],
  },
  {
    id: 'terms-change', legacyId: 20, title: 'What changed in the terms?',
    description: 'Put the old and new terms side by side and see exactly what changed.',
    fields: [
      field('before', 'paste', 'The old terms', 'One per line, like “Rent: $1,500” or “Notice: 2 months”.', true),
      field('after', 'paste', 'The new terms', 'Use the same words as the old ones, like “Rent: $1,620”.', true),
      field('startsOn', 'date', 'When do the new terms start?', 'Optional. Like “1 Nov” or “next month”.'),
    ],
  },
  {
    id: 'cost-split', title: 'Who owes whom?',
    description: 'Add what people paid for. See the fewest payments that make everyone even.',
    fields: [
      field('people', 'list', 'Who’s sharing?', 'Names, like “Ana, Ben, Cy”.', true),
      field('spent', 'lines', 'What did people pay for?', 'One per line: who paid, how much and what for. Like “Ana paid $90 for dinner”. If only some people shared it, add their names in brackets: “Ben paid $10 for a taxi (Ana, Ben)”.', true),
    ],
  },
];

export const CHECKS = definitions.map(check => Object.freeze(check));
export function getCheck(id) { return CHECKS.find(check => check.id === id) || null; }
export function checkForLegacy(capabilityId) {
  return CHECKS.find(check => [].concat(check.legacyId ?? []).includes(Number(capabilityId))) || null;
}
/* Every check starts with empty answers. */
export function blankAnswers(check) { return Object.fromEntries(check.fields.map(item => [item.id, ''])); }
/* Answers the person must still give before a check can run. */
export function missingAnswers(check, answers = {}) {
  return check.fields.filter(item => item.required && !String(answers[item.id] ?? '').trim()).map(item => item.label);
}
