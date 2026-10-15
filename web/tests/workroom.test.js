import test from 'node:test';
import assert from 'node:assert/strict';
import { documentSize, answersFor, readWorkCache, writeWorkCache, requestWork, importWork, exportWork, draftMatches,
  refreshWorkReferences, blankDraft, saveBody, chatToWorkspace, proposalDraft, readDocumentCache, writeDocumentCache, workContextFor } from '../src/lib/workroom.js';
import { WORKSPACES, getWorkspace } from '../shared/workspaces.js';
import { CHECKS, getCheck } from '../shared/checks.js';
import { WORK_LIMITS } from '../shared/work-records.js';

const lookups = { getWorkspace, getCheck };
const memory = () => { const data = new Map(); return { data, getItem: key => data.get(key), setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) }; };

test('deleting selected work detaches only matching chats and updates preserve other contexts', () => {
  const first = { id: 'a', workContext: { id: 'work-a', revision: 'old', scope: 'personal', title: 'A', workspaceId: 'refund' } };
  const second = { id: 'b', workContext: { id: 'work-b', revision: 'other', scope: 'client', title: 'B', workspaceId: 'debug' } };
  const removed = refreshWorkReferences([first, second], { id: 'work-a', deleted: true }, 10);
  assert.equal(removed[0].workContext, undefined); assert.equal(removed[1], second);
  const edited = refreshWorkReferences([first, second], { id: 'work-a', revision: 'new', scope: 'work', title: 'Revised', workspaceId: 'refund' }, 11);
  assert.deepEqual(edited[0].workContext, { id: 'work-a', revision: 'new', title: 'Revised', scope: 'work', workspaceId: 'refund' }); assert.equal(edited[1], second);
  assert.deepEqual(workContextFor({ id: 'c', revision: 'r', title: 'Mine', scope: 'personal', workspaceId: 'custom', starters: ['Go'] }).starters, ['Go']);
});

test('a new draft starts from its workspace, with the check filled in blank', () => {
  const refund = blankDraft(getWorkspace('refund'), getCheck);
  assert.equal(refund.workspaceId, 'refund'); assert.equal(refund.title, 'Get a refund back'); assert.deepEqual(refund.documents, []);
  assert.equal(refund.check.id, 'refund'); assert.deepEqual(refund.check.input, { owed: '', arrived: '', chaseBy: '' });
  assert.equal(blankDraft(getWorkspace('job-application'), getCheck).check, null);
  const custom = blankDraft({ id: 'custom' }, getCheck);
  assert.equal(custom.title, ''); assert.equal(custom.brief, ''); assert.deepEqual(custom.starters, []);
});

test('saves send new document text and keep saved documents by reference', () => {
  const draft = { ...blankDraft(getWorkspace('job-application'), getCheck), title: ' Acme ', documents: [
    { id: 'new', slot: 'cv', name: 'cv.md', text: 'My CV', chars: 5 }, { id: 'old', slot: 'posting', name: 'post.txt', sha: 'a'.repeat(64), chars: 30 }] };
  const body = saveBody(draft, null);
  assert.equal(body.title, 'Acme');
  assert.deepEqual(body.documents, [{ id: 'new', slot: 'cv', name: 'cv.md', text: 'My CV' }, { id: 'old', slot: 'posting', name: 'post.txt', sha: 'a'.repeat(64) }]);
  assert.equal(body.brief, undefined);
  const custom = saveBody({ ...blankDraft({ id: 'custom' }, getCheck), title: 'Mine', brief: 'Do it', starters: [' Go ', ''] }, null);
  assert.deepEqual(custom.starters, ['Go']); assert.equal(custom.brief, 'Do it');
});

test('unsaved changes are noticed in documents, notes, brief and check details', () => {
  const record = { id: 'r', workspaceId: 'refund', title: 'Refund', scope: 'personal', notes: '', check: { id: 'refund', input: { owed: '$1' } }, revision: 'v',
    documents: [{ id: 'd', slot: 'order', name: 'r.txt', sha: 'a'.repeat(64), chars: 4 }] };
  assert.equal(draftMatches(record, structuredClone(record)), true);
  assert.equal(draftMatches(record, { ...record, notes: 'new' }), false);
  assert.equal(draftMatches(record, { ...record, check: { id: 'refund', input: { owed: '$2' } } }), false);
  assert.equal(draftMatches(record, { ...record, documents: [] }), false);
  assert.equal(draftMatches(record, { ...record, documents: [...record.documents, { id: 'e', slot: 'extra', name: 'n.txt', text: 'hi' }] }), false);
  const custom = { ...record, workspaceId: 'custom', brief: 'A', starters: [] };
  assert.equal(draftMatches(custom, { ...custom, brief: 'B' }), false);
});

test('exports carry document text; imports become review drafts and drop server authority', () => {
  const record = { id: 'r', workspaceId: 'refund', title: 'Refund', scope: 'work', notes: 'n', revision: 'v', updated: 'u', output: { status: 'computed' },
    check: { id: 'refund', input: { owed: '$49.99', arrived: '$20' } }, documents: [{ id: 'd', slot: 'order', name: 'r.txt', sha: 'a'.repeat(64), chars: 7 }, { id: 'm', slot: 'extra', name: 'gone.txt', sha: 'b'.repeat(64), chars: 2 }] };
  const exported = exportWork([record], { ['a'.repeat(64)]: 'Receipt' });
  assert.equal(exported.format, 'vaelo-work/v2'); assert.equal(exported.records[0].revision, undefined); assert.equal(exported.records[0].output, undefined);
  assert.deepEqual(exported.records[0].documents, [{ slot: 'order', name: 'r.txt', text: 'Receipt' }, { slot: 'extra', name: 'gone.txt', missing: true }]);
  const [draft] = importWork(JSON.stringify(exported), lookups);
  assert.equal(draft.id, undefined); assert.equal(draft.revision, undefined); assert.equal(draft.output, undefined);
  assert.equal(draft.title, 'Refund'); assert.equal(draft.notes, 'n'); assert.deepEqual(draft.check, { id: 'refund', input: { owed: '$49.99', arrived: '$20', chaseBy: '' } });
  assert.equal(draft.documents.length, 1); assert.equal(draft.documents[0].text, 'Receipt'); assert.ok(draft.documents[0].id);
  assert.throws(() => importWork('{invalid', lookups)); assert.throws(() => importWork(JSON.stringify({ workspaceId: 'nope' }), lookups));
});

test('older exports still import when their check survives, and say so when it does not', () => {
  const [legacy] = importWork(JSON.stringify({ format: 'vaelo-work/v1', records: [{ id: 'old', revision: 'x', capabilityId: 12, title: 'Printers', scope: 'work',
    input: { items: [{ id: 'Laser', price: 200, annualCost: 20, commercialRelationship: 'none', verifiedAt: '2026-10-01T00:00:00Z', specs: {} }], constraints: { years: 3, budget: 400, excludeCommercial: true, requires: {}, asOf: '2026-10-15T00:00:00Z' } } }] }), lookups);
  assert.equal(legacy.workspaceId, 'compare-buy'); assert.deepEqual(legacy.check.input, { options: 'Laser 200, 20 a year', years: '3 years', budget: '400' });
  assert.throws(() => importWork(JSON.stringify({ capabilityId: 31, title: 'Effort', input: {} }), lookups), /doesn’t have any more/);
});

test('a conversation becomes a custom workspace draft from its requests and text files', () => {
  const chat = { title: 'Weekly report', messages: [
    { role: 'user', text: 'Summarise my week for my manager in five bullets.', content: 'ignored when text exists', attachments: [
      { name: 'notes.md', kind: 'text', state: 'ready', body: 'Shipped login' }, { name: 'photo.png', kind: 'image', state: 'ready' }] },
    { role: 'assistant', content: 'Here is the summary' },
    { role: 'user', content: 'Always use British spelling.', attachments: [{ name: 'notes.md', kind: 'text', state: 'ready', body: 'Shipped login' }] },
    { role: 'user', content: 'This failed', failed: true }] };
  const { draft, skipped } = chatToWorkspace(chat);
  assert.equal(draft.workspaceId, 'custom'); assert.equal(draft.title, 'Weekly report');
  assert.equal(draft.brief, 'Summarise my week for my manager in five bullets.\n\nAlways use British spelling.');
  assert.deepEqual(draft.documents.map(d => [d.name, d.text, d.slot]), [['notes.md', 'Shipped login', 'extra']]);
  assert.deepEqual(skipped, ['photo.png']);
  const huge = chatToWorkspace({ title: 'Long', messages: [{ role: 'user', content: 'x'.repeat(WORK_LIMITS.brief + 50) }] });
  assert.equal(huge.draft.brief.length, WORK_LIMITS.brief);
});

test('proposals from replies fill a fresh draft, keeping blank fields the proposal left out', () => {
  const draft = proposalDraft({ workspaceId: 'split-costs', title: 'Lisbon', scope: 'client', notes: '', check: { id: 'cost-split', input: { people: 'Ana, Ben', extra: { sneaky: true } } } }, lookups);
  assert.equal(draft.title, 'Lisbon'); assert.equal(draft.scope, 'client'); assert.deepEqual(draft.check.input, { people: 'Ana, Ben', spent: '' }, 'only plain answers to the check’s own questions are kept');
  assert.equal(proposalDraft({ workspaceId: 'nope' }, lookups), null);
});

test('records and document text stay isolated by account offline, within a size limit', () => {
  const storage = memory();
  writeWorkCache('alice', [{ id: 'alice-only' }], storage); writeWorkCache('bob', [{ id: 'bob-only' }], storage);
  assert.deepEqual(readWorkCache('alice', storage), [{ id: 'alice-only' }]); assert.deepEqual(readWorkCache(null, storage), []);
  storage.data.set('vaelo-work:v1:alice', JSON.stringify({ account: 'bob', records: [{ id: 'wrong-account' }] })); assert.deepEqual(readWorkCache('alice', storage), []);
  storage.data.set('vaelo-work:v1:alice', 'bad JSON'); assert.deepEqual(readWorkCache('alice', storage), []);
  storage.data.set('vaelo-work:v1:carol', JSON.stringify({ account: 'carol', records: [{ id: 'old', capabilityId: 4, title: 'Form', input: { fields: [], values: {} } }] }));
  assert.equal(readWorkCache('carol', storage)[0].workspaceId, 'custom', 'cached older records are read upgraded');
  const records = [{ id: 'r', documents: [{ sha: 'a' }] }];
  assert.equal(writeDocumentCache('alice', { a: 'kept', z: 'unreferenced' }, records, storage), true);
  assert.deepEqual(readDocumentCache('alice', storage), { a: 'kept' }); assert.deepEqual(readDocumentCache('bob', storage), {});
  assert.equal(writeDocumentCache('alice', { a: 'x'.repeat(200) }, records, storage, 100), false);
  assert.deepEqual(readDocumentCache('alice', storage), {}, 'too large to keep means nothing stale is kept either');
});

test('requests include CSRF and exact revision; conflict is surfaced without retry; reads can ask for documents', async () => {
  let calls = 0;
  await assert.rejects(requestWork({ action: 'run', id: 'one', base: 'version-1' }, { csrf: 'csrf-token', request: async (url, options) => {
    calls++; assert.equal(url, '/api/work'); assert.equal(options.headers['X-CSRF-Token'], 'csrf-token'); assert.equal(options.credentials, 'same-origin'); assert.equal(JSON.parse(options.body).base, 'version-1');
    return { ok: false, status: 409, json: async () => ({ error: 'Changed elsewhere' }) };
  } }), error => error.status === 409 && error.message === 'Changed elsewhere');
  assert.equal(calls, 1);
  await requestWork(null, { query: '?id=r&documents=1', request: async url => { assert.equal(url, '/api/work?id=r&documents=1'); return { ok: true, json: async () => ({}) }; } });
});

test('files are sized in pages, and answers keep only the check’s own questions', () => {
  assert.equal(documentSize(400), 'A short note'); assert.equal(documentSize(3_200), 'About a page'); assert.equal(documentSize(12_000), 'About 4 pages');
  const refund = getCheck('refund');
  assert.deepEqual(answersFor(refund, { owed: '$5', chaseBy: 7, stray: 'x' }), { owed: '$5', arrived: '', chaseBy: '' });
  const document = getCheck('document');
  assert.deepEqual(answersFor(document, { source: { kind: 'vaelo-document' } }).source, { kind: 'vaelo-document' }, 'only Verify’s pick rides along');
  assert.ok(CHECKS.length >= 8 && WORKSPACES.length >= 25);
});
