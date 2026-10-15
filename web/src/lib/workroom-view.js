import { AUDIENCES } from '../../shared/workspaces.js';
import { formatMoney, formatDate } from '../../shared/plain.js';

export const AUDIENCE_NAMES = Object.fromEntries(AUDIENCES.map(item => [item.id, item.label]));

// Accents are dropped so "resume" finds "résumé".
const fold = text => text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/* Catalogue search: every word must appear somewhere in the workspace's
   title, summary, audience, keywords, documents or starters. */
export function matchWorkspaces(workspaces, query = '', audience = 'all') {
  const words = fold(query).split(/\s+/).filter(Boolean);
  return workspaces.filter(item => {
    if (audience !== 'all' && item.audience !== audience) return false;
    const text = fold([item.title, item.summary, AUDIENCE_NAMES[item.audience], ...(item.keywords || []),
      ...item.slots.flatMap(s => [s.label, s.hint]), ...item.starters].join(' '));
    return words.every(word => text.includes(word));
  });
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const both = names => names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0] ?? '';

/* A check's result in plain words: one headline and a few short lines. */
export function resultOverview(output) {
  const r = output?.result || {};
  const m = value => formatMoney(value, r.symbol);
  if (Array.isArray(r.says)) {
    const missing = r.says.filter(item => !item.found);
    return { title: missing.length ? `${plural(missing.length, 'thing is', 'things are')} missing from your document` : 'Your document says everything you listed',
      facts: [...missing.map(item => `Missing: ${item.text}`), ...r.says.filter(item => item.found).map(item => `Found: ${item.text}`)] };
  }
  if (r.stillOwed !== undefined) {
    const facts = [`${m(r.received)} of ${m(r.owed)} has come back so far.`];
    for (const line of r.waiting || []) facts.push(`Not counted yet: “${line}”`);
    if (r.stillOwed > 0 && r.chaseNow) facts.push(`It’s past ${formatDate(r.chaseBy)}. Time to chase it.`);
    else if (r.stillOwed > 0 && r.chaseBy) facts.push(`Chase it if it isn’t back by ${formatDate(r.chaseBy)}.`);
    return { title: r.stillOwed > 0 ? `You’re still owed ${m(r.stillOwed)}` : `Your full refund of ${m(r.owed)} is back`, facts };
  }
  if (Array.isArray(r.missing)) return {
    title: r.missing.length ? `${plural(r.missing.length, 'question is', 'questions are')} still empty` : 'Everything you need is filled in',
    facts: [...r.missing.map(q => `Still empty: ${q}`), ...(r.skipped || []).map(q => `You can skip: ${q}`), `${r.answered} of ${r.total} answered.`] };
  if (r.status === 'proposed') return { title: `${r.choice} works best for everyone`, facts: r.alsoWorks?.length ? [`Also works for everyone: ${both(r.alsoWorks)}.`] : [] };
  if (r.status === 'infeasible') return { title: 'Nothing works for everyone',
    facts: r.closest ? [`Closest: ${r.closest}. ${both(r.cant)} can’t do it.`] : [] };
  if (Array.isArray(r.options) && r.years !== undefined) return {
    title: r.best ? `${r.best} costs least over ${plural(r.years, 'year')}` : 'Nothing fits your budget',
    facts: r.options.map(o => `${o.name}: ${m(o.total)} in total${o.yearly ? ` (${m(o.price)} plus ${m(o.yearly)} a year)` : ''}${o.overBudget ? '. Over budget.' : ''}`) };
  if (Array.isArray(r.giveUp)) {
    if (r.status === 'feasible') return { title: `${both(r.fits)} ${r.fits.length === 1 ? 'fits' : 'fit'} everything`, facts: [] };
    if (r.status === 'relaxation-proposed') return { title: 'Nothing fits everything, but you’re close',
      facts: r.giveUp.slice(0, 4).map(item => `If you skip “${item.skip.join('” and “')}”, ${both(item.thenFits)} ${item.thenFits.length === 1 ? 'fits' : 'fit'}.`) };
    return { title: 'Nothing fits, even skipping the things you could skip', facts: ['Try marking more things “(could skip)”, or add another choice.'] };
  }
  if (Array.isArray(r.changes)) return {
    title: r.changes.length ? `${plural(r.changes.length, 'thing')} changed` : 'Nothing changed',
    facts: [...r.changes.map(c => c.before === null ? `New: ${c.term} is ${c.after}` : c.after === null ? `Gone: ${c.term} (was ${c.before})` : `${c.term}: ${c.before} → ${c.after}`),
      ...(r.startsOn ? [`The new terms ${r.started ? 'started' : 'start'} on ${formatDate(r.startsOn)}.`] : [])] };
  if (Array.isArray(r.payments)) return {
    title: r.payments.length ? `${plural(r.payments.length, 'payment')} ${r.payments.length === 1 ? 'makes' : 'make'} everyone even` : 'Everyone is already even',
    facts: [...r.payments.map(p => `${p.from} pays ${p.to} ${m(p.amount)}`), `Total spent: ${m(r.total)}.`] };
  return { title: 'Your answer is ready', facts: [] };
}
