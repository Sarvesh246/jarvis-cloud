import { WORKSPACES, CUSTOM_WORKSPACE, RETIRED_WORKSPACE, getWorkspace } from './workspaces.js';
import { CHECKS, getCheck, checkForLegacy } from './checks.js';

// How much a saved workspace may hold, and how much of it a chat can read.
export const WORK_LIMITS = Object.freeze({
  documents: 8,
  documentChars: 120_000,
  recordDocumentChars: 300_000,
  notes: 8_000,
  brief: 12_000,
  starters: 6,
  starterChars: 200,
  // What one chat request carries for a selected workspace: brief, notes,
  // documents and check result together. Roughly 40,000 tokens, so a CV, a
  // job posting and a long contract all arrive whole.
  contextChars: 160_000,
  // Workspace plus conversation together. Hermes summarises history (a model
  // call of its own) from 64,000 tokens, so long chats give the workspace
  // less room instead of tipping every reply into compression.
  requestChars: 230_000,
  // A long chat never squeezes the workspace below this.
  contextFloorChars: 48_000,
});

/* The workspace budget left once the conversation so far is counted. */
export function contextBudget(conversationChars = 0) {
  const left = WORK_LIMITS.requestChars - Math.max(0, conversationChars);
  return Math.min(WORK_LIMITS.contextChars, Math.max(WORK_LIMITS.contextFloorChars, left));
}

const SCOPES = ['personal', 'work', 'client'];
const defined = object => Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined && value !== null && value !== ''));
const day = value => typeof value === 'string' && value ? value.slice(0, 10) : undefined;

// Inputs saved by the old numbered tools, rewritten as the plain answers the
// checks ask for now, so nothing technical comes back into view.
const text = value => value === undefined || value === null ? '' : typeof value === 'string' ? value : JSON.stringify(value);
const amount = (cents, currency) => Number.isFinite(cents) ? `${cents / 100}${currency ? ` ${currency}` : ''}` : '';
const expected = value => { try { return typeof value === 'string' ? JSON.parse(value) : value; } catch { return value; } };
const LEGACY_INPUT = {
  document: ({ contract = {}, source }) => {
    const checks = Array.isArray(contract.checks) ? contract.checks : [];
    return defined({
      mustSay: checks.filter(c => c.path?.[0] === 'text').map(c => text(expected(c.expected))).join('\n'),
      title: text(expected(checks.find(c => c.path?.[0] === 'title')?.expected)), source,
    });
  },
  refund: ({ record = {}, observations = [] }) => defined({
    owed: amount(record.expectedCents, record.currency), chaseBy: day(record.followupAt),
    arrived: observations.map(o => `${amount(o.amountCents, o.currency)}${o.status && o.status !== 'settled' ? ` ${o.status}` : ''}`).join('\n'),
  }),
  form: ({ fields = [], values = {} }) => ({
    form: fields.map(f => `${f.label || f.id}${f.required ? '' : ' (optional)'}: ${text(values[f.id])}`.trimEnd()).join('\n'),
  }),
  'group-choice': ({ members = [], options = [] }) => defined({
    choices: options.join(', '),
    people: members.map(m => `${m.id}: ${[...(m.acceptable || [])].sort((a, b) => (m.costs?.[a] ?? 0) - (m.costs?.[b] ?? 0)).join(', ')}`).join('\n'),
    helped: members.filter(m => m.priorBurden > 0).map(m => m.id).join(', '),
  }),
  purchase: ({ items = [], constraints = {} }) => defined({
    options: items.map(i => `${i.id} ${i.price}${i.annualCost ? `, ${i.annualCost} a year` : ''}`).join('\n'),
    years: constraints.years === undefined ? '' : `${constraints.years} years`, budget: constraints.budget === undefined ? '' : String(constraints.budget),
  }),
  'plan-fix': ({ options = [], constraints = [] }) => ({
    choices: options.join(', '),
    rules: constraints.map(c => `${c.id}: ${(c.allowed || []).join(', ')}${c.mayRelax ? ' (could skip)' : ''}`).join('\n'),
  }),
  'terms-change': ({ before = {}, after = {} }) => defined({
    before: Object.entries(before.terms ?? {}).map(([k, v]) => `${k}: ${text(v)}`).join('\n'),
    after: Object.entries(after.terms ?? {}).map(([k, v]) => `${k}: ${text(v)}`).join('\n'),
    startsOn: day(after.effectiveAt),
  }),
};
const LEGACY_WORKSPACE = { document: 'document-check', refund: 'refund', 'group-choice': 'group-plans', purchase: 'compare-buy', 'plan-fix': 'decision', 'terms-change': 'terms-changed', form: CUSTOM_WORKSPACE };

/* Records saved before workspaces named a numbered capability. Those whose
   check survives become workspaces with that check; the rest stay readable
   as retired records until the person exports or deletes them. Nothing is
   written back until the person saves. */
export function upgradeRecord(record) {
  if (!record || record.deleted || record.workspaceId || record.capabilityId === undefined) return record;
  const { capabilityId, input, output, ...rest } = record;
  const check = checkForLegacy(capabilityId);
  if (!check) return { ...rest, workspaceId: RETIRED_WORKSPACE, notes: '', documents: [], check: null, output: null,
    legacy: { capabilityId, input: input ?? {}, output: output ?? null } };
  let migrated;
  try { migrated = LEGACY_INPUT[check.id](input ?? {}); } catch { migrated = {}; }
  return { ...rest, workspaceId: LEGACY_WORKSPACE[check.id], notes: '', documents: [], check: { id: check.id, input: migrated }, output: output ?? null };
}

/* The definition a record works from: a catalogue workspace, or the brief
   and starters the person wrote for their own. */
export function workspaceFor(record) {
  if (!record) return null;
  if (record.workspaceId === CUSTOM_WORKSPACE) return {
    id: CUSTOM_WORKSPACE, audience: 'custom', title: record.title || 'Your workspace',
    summary: 'A workspace you set up yourself.', brief: record.brief || '', slots: [], starters: record.starters || [],
    check: record.check?.id || null, custom: true,
  };
  if (record.workspaceId === RETIRED_WORKSPACE) return { id: RETIRED_WORKSPACE, audience: 'retired', title: record.title,
    summary: 'This task used a tool that has been retired.', brief: '', slots: [], starters: [], check: null, retired: true };
  return getWorkspace(record.workspaceId);
}

export function checkFor(record) {
  const id = record?.check?.id || workspaceFor(record)?.check;
  return id ? getCheck(id) : null;
}

/* Splits a character budget between documents: short ones stay whole, and
   whatever they leave is shared by the long ones. */
export function allocate(lengths, budget) {
  const shares = lengths.map(() => 0);
  let remaining = Math.max(0, budget);
  let open = lengths.map((length, index) => ({ length, index })).filter(item => item.length > 0);
  while (open.length) {
    const share = Math.floor(remaining / open.length);
    const fits = open.filter(item => item.length <= share);
    if (!fits.length) { open.forEach(item => { shares[item.index] = share; }); break; }
    for (const item of fits) { shares[item.index] = item.length; remaining -= item.length; }
    open = open.filter(item => item.length > share);
  }
  return shares;
}

/* A long document keeps its opening and its ending, which usually carry the
   most context, and says how much of the middle was left out. */
export function excerpt(text, limit) {
  if (text.length <= limit) return text;
  if (limit < 200) return `[${text.length.toLocaleString('en-US')} characters left out to fit]`;
  const gap = `\n\n[… ${(text.length - limit).toLocaleString('en-US')} characters from the middle are left out to fit …]\n\n`;
  const room = Math.max(0, limit - gap.length);
  const head = Math.floor(room * 0.7);
  return text.slice(0, head) + gap + text.slice(text.length - (room - head));
}

/* What a chat can read of a workspace: the brief and notes whole, then the
   documents shared fairly across what is left. Works on lengths alone so
   the Workroom can say in advance whether anything will be trimmed. */
export function contextPlan({ brief = '', notes = '', documents = [], extra = 0 }, budget = WORK_LIMITS.contextChars) {
  const fixed = Math.min(brief.length, WORK_LIMITS.brief) + Math.min(notes.length, WORK_LIMITS.notes) + extra + 600;
  const lengths = documents.map(item => item.chars ?? item.text?.length ?? 0);
  const total = lengths.reduce((sum, length) => sum + length, 0);
  const room = Math.max(0, budget - fixed);
  const shares = allocate(lengths, room);
  const trimmed = documents.map((item, index) => ({ ...item, keep: shares[index], trimmed: shares[index] < lengths[index] }));
  return { documents: trimmed, total, room, trimmed: trimmed.some(item => item.trimmed) };
}

export function documentLabel(workspace, documentRef) {
  return workspace?.slots?.find(item => item.id === documentRef.slot)?.label || 'Extra document';
}

export { WORKSPACES, CHECKS, CUSTOM_WORKSPACE, RETIRED_WORKSPACE, SCOPES };
