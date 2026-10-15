import { WORK_LIMITS, upgradeRecord, CUSTOM_WORKSPACE, RETIRED_WORKSPACE } from '../../shared/work-records.js';
import { blankAnswers } from '../../shared/checks.js';

// Shared UI helpers. Cached records are acknowledged server versions, never a
// queue that might overwrite a newer record when connectivity returns.
export const workCacheKey = (sub) => `vaelo-work:v1:${sub}`;
/* How long a document is, said the way people say it. */
export function documentSize(chars = 0) {
  if (chars < 1_500) return 'A short note';
  const pages = Math.round(chars / 3_000);
  return pages <= 1 ? 'About a page' : `About ${pages} pages`;
}

/* A check's answers are plain text; anything else (from an old copy or a
   proposal) is dropped so the form only ever shows words. */
export function answersFor(check, input = {}) {
  const answers = blankAnswers(check);
  for (const item of check.fields) if (typeof input?.[item.id] === 'string') answers[item.id] = input[item.id];
  if (check.needsSource && input?.source && typeof input.source === 'object') answers.source = input.source;
  return answers;
}

export function readWorkCache(sub, storage = globalThis.localStorage) {
  if (!sub) return [];
  try {
    const saved = JSON.parse(storage?.getItem(workCacheKey(sub)) || 'null');
    return saved?.account === sub && Array.isArray(saved.records) ? saved.records.map(upgradeRecord) : [];
  } catch { return []; }
}

export function writeWorkCache(sub, records, storage = globalThis.localStorage) {
  if (!sub) return false;
  try { storage?.setItem(workCacheKey(sub), JSON.stringify({ account: sub, records })); return Boolean(storage); }
  catch { return false; }
}

export async function requestWork(body, { csrf, signal, query = '', request = fetch } = {}) {
  const response = await request(`/api/work${body ? '' : query}`, body ? {
    method: 'POST', credentials: 'same-origin', signal,
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf || '' }, body: JSON.stringify(body),
  } : { signal, credentials: 'same-origin' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(typeof data.error === 'string' ? data.error : 'Something went wrong. Please try again.'), { status: response.status });
  return data;
}

const SCOPE_NAMES = ['personal', 'work', 'client'];
const clip = (value, max) => typeof value === 'string' ? value.slice(0, max) : '';
const newId = () => crypto.randomUUID();

/* A fresh draft for a workspace from the catalogue, or a blank one the
   person sets up themselves. */
export function blankDraft(workspace, getCheck) {
  const custom = workspace.id === CUSTOM_WORKSPACE;
  const check = workspace.check ? getCheck(workspace.check) : null;
  return { id: newId(), workspaceId: workspace.id, title: custom ? '' : workspace.title, scope: 'personal', notes: '', documents: [],
    check: check ? { id: check.id, input: blankAnswers(check) } : null, ...(custom && { brief: '', starters: [] }) };
}

/* A proposal from a reply, filled into a fresh draft of its workspace. */
export function proposalDraft(proposal, { getWorkspace, getCheck }) {
  const workspace = proposal.workspaceId === CUSTOM_WORKSPACE ? { id: CUSTOM_WORKSPACE } : getWorkspace(proposal.workspaceId);
  if (!workspace) return null;
  const draft = blankDraft(workspace, getCheck);
  const check = proposal.check && getCheck(proposal.check.id);
  return { ...draft, title: proposal.title || draft.title || 'Proposed workspace', scope: SCOPE_NAMES.includes(proposal.scope) ? proposal.scope : 'personal',
    notes: clip(proposal.notes, WORK_LIMITS.notes),
    check: check ? { id: check.id, input: answersFor(check, proposal.check.input) } : draft.check };
}

/* What a save sends: new documents with their text, saved ones by reference. */
export function saveBody(draft, check) {
  return {
    id: draft.id, workspaceId: draft.workspaceId, title: draft.title.trim(), scope: draft.scope, notes: draft.notes || '',
    documents: (draft.documents || []).map(doc => typeof doc.text === 'string'
      ? { id: doc.id, slot: doc.slot, name: doc.name, text: doc.text } : { id: doc.id, slot: doc.slot, name: doc.name, sha: doc.sha }),
    check: draft.check ? { id: draft.check.id, input: check ? answersFor(check, draft.check.input) : draft.check.input } : null,
    ...(draft.workspaceId === CUSTOM_WORKSPACE && { brief: draft.brief || '', starters: (draft.starters || []).map(s => s.trim()).filter(Boolean) }),
  };
}

const docKey = doc => `${doc.id}|${doc.slot}|${doc.name}|${typeof doc.text === 'string' ? `new:${doc.text.length}` : doc.sha}`;
export function draftMatches(record, draft) {
  if (!record || !draft || record.id !== draft.id) return false;
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  return record.workspaceId === draft.workspaceId && record.title === draft.title && record.scope === draft.scope
    && (record.notes || '') === (draft.notes || '') && same(record.check, draft.check)
    && same((record.documents || []).map(docKey), (draft.documents || []).map(docKey))
    && (record.workspaceId !== CUSTOM_WORKSPACE || ((record.brief || '') === (draft.brief || '') && same(record.starters || [], draft.starters || [])));
}

/* Exports carry document text so a file restores the whole workspace. */
export function exportWork(records, texts = {}) {
  return { format: 'vaelo-work/v2', exported: new Date().toISOString(), records: records.map(record => {
    const { revision, updated, output, deleted, ...rest } = record;
    return { ...rest, documents: (record.documents || []).map(doc => ({ slot: doc.slot, name: doc.name,
      ...(typeof texts[doc.sha] === 'string' ? { text: texts[doc.sha] } : { missing: true }) })) };
  }) };
}

export function importWork(text, { getWorkspace, getCheck }) {
  if (text.length > 4_000_000) throw new Error('That file is too big. Choose one under 4 MB.');
  const parsed = JSON.parse(text);
  const candidates = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.records) ? parsed.records : [parsed];
  if (!candidates.length || candidates.length > 100) throw new Error('That backup file is empty or too big. Choose a backup with 1 to 100 workspaces.');
  return candidates.map(raw => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('That isn’t a Vaelo backup file.');
    const record = upgradeRecord({ id: 'import', ...raw });
    if (record.workspaceId === RETIRED_WORKSPACE) throw new Error(`“${clip(raw.title, 80) || 'A task'}” uses a tool Vaelo doesn’t have any more, so it can’t be loaded.`);
    const custom = record.workspaceId === CUSTOM_WORKSPACE;
    const workspace = custom ? null : getWorkspace(record.workspaceId);
    if (!custom && !workspace) throw new Error('This backup has a workspace Vaelo doesn’t offer any more.');
    const check = record.check && getCheck(record.check.id) && record.check.input && typeof record.check.input === 'object' && !Array.isArray(record.check.input)
      ? { id: record.check.id, input: answersFor(getCheck(record.check.id), record.check.input) } : null;
    const documents = (Array.isArray(record.documents) ? record.documents : []).filter(doc => typeof doc?.text === 'string' && doc.text.trim()).slice(0, WORK_LIMITS.documents)
      .map(doc => ({ id: newId(), slot: typeof doc.slot === 'string' && (custom || doc.slot === 'extra' || workspace.slots.some(s => s.id === doc.slot)) ? doc.slot : 'extra',
        name: clip(doc.name, 160) || 'Document', text: doc.text.slice(0, WORK_LIMITS.documentChars), chars: Math.min(doc.text.length, WORK_LIMITS.documentChars) }));
    // IDs, outputs and revisions are not imported as trusted saved state.
    return { workspaceId: record.workspaceId, title: clip(record.title, 160) || workspace?.title || 'Imported workspace',
      scope: SCOPE_NAMES.includes(record.scope) ? record.scope : 'personal', notes: clip(record.notes, WORK_LIMITS.notes), documents,
      check: custom || workspace?.check === check?.id ? check : null,
      ...(custom && { brief: clip(record.brief, WORK_LIMITS.brief), starters: (Array.isArray(record.starters) ? record.starters : []).filter(s => typeof s === 'string' && s.trim()).slice(0, WORK_LIMITS.starters).map(s => s.slice(0, WORK_LIMITS.starterChars)) }) };
  });
}

/* A conversation that went well becomes a workspace to review: what the
   person asked for becomes its brief, and the text files they shared become
   its documents. Nothing is saved until they choose to. */
export function chatToWorkspace(chat) {
  const asked = (chat?.messages || []).filter(m => m.role === 'user' && !m.failed)
    .map(m => (typeof m.text === 'string' ? m.text : typeof m.content === 'string' ? m.content : '').trim()).filter(Boolean);
  let brief = asked.join('\n\n');
  if (brief.length > WORK_LIMITS.brief) brief = brief.slice(0, WORK_LIMITS.brief - 1) + '…';
  const seen = new Set(); const documents = []; const skipped = [];
  for (const file of (chat?.messages || []).flatMap(m => m.role === 'user' ? m.attachments || [] : [])) {
    if (file.kind === 'image' || file.state !== 'ready' || typeof file.body !== 'string') { if (file.kind === 'image') skipped.push(file.name); continue; }
    const key = `${file.name}:${file.body.length}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (documents.length >= WORK_LIMITS.documents || file.body.length > WORK_LIMITS.documentChars) { skipped.push(file.name); continue; }
    documents.push({ id: newId(), slot: 'extra', name: clip(file.name, 160) || 'Document', text: file.body, chars: file.body.length });
  }
  return { draft: { id: newId(), workspaceId: CUSTOM_WORKSPACE, title: clip(chat?.title, 160) || 'From a conversation', scope: 'personal',
    notes: '', documents, check: null, brief, starters: [] }, skipped };
}

/* Document text is kept per account for reading offline, within a modest
   share of the browser's storage. If it doesn't fit, it simply isn't kept. */
export const documentCacheKey = sub => `vaelo-work-docs:v1:${sub}`;
export function readDocumentCache(sub, storage = globalThis.localStorage) {
  if (!sub) return {};
  try {
    const saved = JSON.parse(storage?.getItem(documentCacheKey(sub)) || 'null');
    return saved?.account === sub && saved.texts && typeof saved.texts === 'object' ? saved.texts : {};
  } catch { return {}; }
}
export function writeDocumentCache(sub, texts, records, storage = globalThis.localStorage, limit = 1_500_000) {
  if (!sub) return false;
  const wanted = new Set(records.flatMap(r => (r.documents || []).map(d => d.sha)));
  const kept = Object.fromEntries(Object.entries({ ...readDocumentCache(sub, storage), ...texts })
    .filter(([sha, text]) => wanted.has(sha) && typeof text === 'string'));
  const value = JSON.stringify({ account: sub, texts: kept });
  try {
    if (value.length > limit) { storage?.removeItem?.(documentCacheKey(sub)); return false; }
    storage?.setItem(documentCacheKey(sub), value); return Boolean(storage);
  } catch { return false; }
}

export function workContextFor(record) {
  return { id: record.id, revision: record.revision, title: record.title, scope: record.scope, workspaceId: record.workspaceId,
    ...(record.workspaceId === CUSTOM_WORKSPACE && record.starters?.length && { starters: record.starters }) };
}

export function refreshWorkReferences(chats, record, updated = Date.now()) {
  if (!record?.id) return chats;
  return chats.map(chat => !chat.workContext || chat.workContext.id !== record.id ? chat : {
    ...chat, updated, workContext: record.deleted ? undefined : workContextFor(record),
  });
}
