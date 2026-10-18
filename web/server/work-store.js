import { createHash, randomUUID } from "node:crypto";
import { get, put, del, isConflict, storageConfigured } from "./kv-storage.js";
import { HttpError } from "./security.js";
import { WORK_LIMITS, upgradeRecord, CUSTOM_WORKSPACE } from "../shared/work-records.js";
import { getWorkspace } from "../shared/workspaces.js";
import { getCheck } from "../shared/checks.js";

export const MAX_WORK_RECORDS = 100;
export const MAX_WORK_BYTES = 2_000_000;
export const MAX_WORK_INPUT_BYTES = 64_000;
// A save or import carries document text, so requests may be larger than the index.
export const MAX_WORK_REQUEST_BYTES = 4_000_000;
const MAX_TOMBSTONES = 500;
const idPattern = /^[a-zA-Z0-9_-]{1,100}$/;
const slotPattern = /^[a-zA-Z0-9_-]{1,60}$/;
const shaPattern = /^[a-f0-9]{64}$/;
const scopes = new Set(["personal", "work", "client"]);
const forbidden = new Set(["__proto__", "prototype", "constructor"]);
const bytes = value => Buffer.byteLength(JSON.stringify(value));
const sha256 = text => createHash("sha256").update(text).digest("hex");

export function checkWorkId(id) {
  if (typeof id !== "string" || !idPattern.test(id) || forbidden.has(id))
    throw new HttpError(400, "Invalid work record identifier.");
}
function accountRoot(sub) {
  if (typeof sub !== "string" || !sub) throw new HttpError(401, "Sign in to use Vaelo.");
  return `work/${createHash("sha256").update(sub).digest("hex")}`;
}
export function workAccountPath(sub) { return `${accountRoot(sub)}/index.json`; }
/* Documents are stored once per account under their content hash, so every
   saved version of a workspace keeps pointing at exactly the text it had. */
export function workDocumentPath(sub, sha) {
  if (typeof sha !== "string" || !shaPattern.test(sha)) throw new HttpError(400, "Invalid document reference.");
  return `${accountRoot(sub)}/documents/${sha}.txt`;
}
function checkBase(base) {
  if (base !== null) checkWorkId(base);
}
function jsonValue(value, maxBytes) {
  let nodes = 0;
  const visit = (item, depth) => {
    if (++nodes > 15000 || depth > 30) throw new HttpError(413, "Work data is too complex.");
    if (item === null || typeof item === "string" || typeof item === "boolean") return;
    if (typeof item === "number" && Number.isFinite(item)) return;
    if (typeof item !== "object" || (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype))
      throw new HttpError(400, "Work data must be ordinary JSON.");
    for (const [key, child] of Object.entries(item)) {
      if (forbidden.has(key)) throw new HttpError(400, "Unsupported work data key.");
      visit(child, depth + 1);
    }
  };
  visit(value, 0);
  if (bytes(value) > maxBytes) throw new HttpError(413, "Work data is too large.");
  return structuredClone(value);
}
const textField = (value, max, message) => {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" || value.length > max) throw new HttpError(413, message);
  return value;
};

function normalizeDocuments(documents) {
  if (documents === undefined || documents === null) return { documents: [], chars: 0 };
  if (!Array.isArray(documents) || documents.length > WORK_LIMITS.documents)
    throw new HttpError(400, `There’s room for ${WORK_LIMITS.documents} files here. Remove one to add another.`);
  const ids = new Set();
  let chars = 0;
  const normalized = documents.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new HttpError(400, "Invalid document.");
    checkWorkId(item.id);
    if (ids.has(item.id)) throw new HttpError(400, "Each document needs its own identifier.");
    ids.add(item.id);
    if (typeof item.slot !== "string" || !slotPattern.test(item.slot)) throw new HttpError(400, "Invalid document slot.");
    if (typeof item.name !== "string" || !item.name.trim() || item.name.length > 160) throw new HttpError(400, "Each document needs a name of up to 160 characters.");
    if (typeof item.text === "string") {
      if (!item.text.trim()) throw new HttpError(400, `${item.name.trim()} is empty.`);
      if (item.text.length > WORK_LIMITS.documentChars)
        throw new HttpError(413, `${item.name.trim()} is too long to keep here. Paste just the part you need.`);
      chars += item.text.length;
      return { id: item.id, slot: item.slot, name: item.name.trim(), text: item.text };
    }
    if (typeof item.sha !== "string" || !shaPattern.test(item.sha)) throw new HttpError(400, "A document needs its text or a saved reference.");
    return { id: item.id, slot: item.slot, name: item.name.trim(), sha: item.sha };
  });
  return { documents: normalized, chars };
}

export function normalizeWorkRecord(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new HttpError(400, "Invalid work record.");
  const record = upgradeRecord(input);
  checkWorkId(record.id);
  const custom = record.workspaceId === CUSTOM_WORKSPACE;
  if (record.kind !== undefined && record.kind !== 'project') throw new HttpError(400, "Choose a supported work type.");
  if (record.kind === 'project' && (!custom || record.check)) throw new HttpError(400, "Projects use their own files and instructions, without a task check.");
  const workspace = custom ? null : getWorkspace(record.workspaceId);
  if (!custom && !workspace) throw new HttpError(400, record.legacy ? "This was made with a tool Vaelo doesn’t have any more. Save a backup copy or delete it." : "That workspace isn’t available any more.");
  if (typeof record.title !== "string" || !record.title.trim() || record.title.length > 160)
    throw new HttpError(400, "Please give it a name.");
  const scope = record.scope ?? "personal";
  if (!scopes.has(scope)) throw new HttpError(400, "Choose personal, work, or client scope.");
  let check = null;
  if (record.check !== undefined && record.check !== null) {
    if (typeof record.check !== "object" || !getCheck(record.check.id)) throw new HttpError(400, "Choose a supported check.");
    if (!custom && workspace.check !== record.check.id) throw new HttpError(400, "This workspace does not offer that check.");
    const input = record.check.input;
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new HttpError(400, "Check answers are missing.");
    // Answers are plain text, one per question; only Verify adds the document it picked.
    const definition = getCheck(record.check.id);
    for (const [key, value] of Object.entries(input)) {
      if (key === "source" && definition.needsSource) continue;
      if (!definition.fields.some(item => item.id === key) || typeof value !== "string")
        throw new HttpError(400, "These answers belong to a different check. Start the check again.");
    }
    check = { id: record.check.id, input: jsonValue(input, MAX_WORK_INPUT_BYTES) };
  }
  const { documents, chars } = normalizeDocuments(record.documents);
  if (workspace) for (const item of documents)
    if (item.slot !== "extra" && !workspace.slots.some(slot => slot.id === item.slot)) throw new HttpError(400, "Invalid document slot.");
  const normalized = { id: record.id, workspaceId: record.workspaceId, title: record.title.trim(), scope,
    ...(record.kind === 'project' && { kind: 'project' }),
    notes: textField(record.notes, WORK_LIMITS.notes, `Notes are limited to ${WORK_LIMITS.notes.toLocaleString("en-US")} characters.`),
    check, documents, incomingChars: chars };
  if (custom) {
    normalized.brief = textField(record.brief, WORK_LIMITS.brief, `A brief is limited to ${WORK_LIMITS.brief.toLocaleString("en-US")} characters.`);
    const starters = record.starters ?? [];
    if (!Array.isArray(starters) || starters.length > WORK_LIMITS.starters || starters.some(item => typeof item !== "string" || !item.trim() || item.length > WORK_LIMITS.starterChars))
      throw new HttpError(400, `Add up to ${WORK_LIMITS.starters} starters of up to ${WORK_LIMITS.starterChars} characters.`);
    normalized.starters = starters.map(item => item.trim());
  }
  // Client-supplied output, revision, timestamps and deletion flags never cross this boundary.
  return normalized;
}

const sameCheck = (a, b) => Boolean(a && b && a.id === b.id && JSON.stringify(a.input) === JSON.stringify(b.input));
const references = records => new Set(Object.values(records).filter(item => !item.deleted)
  .flatMap(item => (item.documents || []).map(doc => doc.sha)));

export class WorkStore {
  constructor(sub, storage = { get, put, del }, { engine, now = () => new Date().toISOString() } = {}) {
    this.sub = sub; this.path = workAccountPath(sub); this.storage = storage; this.engine = engine; this.now = now;
  }
  /* Records saved before workspaces are read in their upgraded form and are
     written back that way the next time anything in the account is saved. */
  async snapshot() {
    const blob = await this.storage.get(this.path, { access: "private", useCache: false });
    if (!blob) return { records: {}, etag: null };
    const text = await new Response(blob.stream).text();
    if (Buffer.byteLength(text) > MAX_WORK_BYTES) throw new HttpError(503, "Your saved work couldn’t be opened. Please try again later.");
    const data = JSON.parse(text);
    if (data.schemaVersion !== 1 || !data.records || typeof data.records !== "object" || Array.isArray(data.records))
      throw new HttpError(503, "Your saved work couldn’t be opened. Please try again later.");
    const records = Object.fromEntries(Object.entries(data.records).map(([id, record]) => [id, upgradeRecord(record)]));
    return { records, etag: blob.blob.etag };
  }
  async list() {
    return Object.values((await this.snapshot()).records).filter(record => !record.deleted)
      .sort((a, b) => b.updated.localeCompare(a.updated));
  }
  async record(id) {
    checkWorkId(id);
    const record = (await this.snapshot()).records[id];
    if (!record || record.deleted) throw new HttpError(404, "This couldn’t be found. It may have been deleted.");
    return record;
  }
  async mutate(change) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const current = await this.snapshot();
      const { records, result } = change(current.records);
      /* Tombstones only need to outlast stale copies on other devices, so the
         oldest go once there are too many rather than blocking every delete. */
      const tombstones = Object.values(records).filter(item => item.deleted)
        .sort((a, b) => a.updated.localeCompare(b.updated));
      for (const old of tombstones.slice(0, Math.max(0, tombstones.length - MAX_TOMBSTONES))) delete records[old.id];
      const all = Object.values(records);
      if (all.filter(item => !item.deleted).length > MAX_WORK_RECORDS)
        throw new HttpError(413, "There’s room for 100 saved workspaces, and you’ve used them all. Save a backup, then delete some to make room.");
      const text = JSON.stringify({ schemaVersion: 1, records });
      if (Buffer.byteLength(text) > MAX_WORK_BYTES) throw new HttpError(413, "Your saved work is full. Save a backup, then delete some to make room.");
      try {
        await this.storage.put(this.path, text, { access: "private", addRandomSuffix: false,
          contentType: "application/json", allowOverwrite: Boolean(current.etag),
          ...(current.etag ? { ifMatch: current.etag } : {}) });
        await this.collect(current.records, records);
        return result;
      } catch (error) {
        if (!isConflict(error)) throw error;
      }
    }
    throw new HttpError(409, "Your work changed somewhere else while saving. Please try again in a moment.");
  }
  /* Document text no saved workspace points at any more is removed. Best
     effort: a failed delete leaves an unreferenced file, never a broken one. */
  async collect(before, after) {
    if (!this.storage.del) return;
    const kept = references(after);
    let orphans = [...references(before)].filter(sha => !kept.has(sha));
    if (!orphans.length) return;
    // A save that landed since this change may point at the same text again.
    try { const now = references((await this.snapshot()).records); orphans = orphans.filter(sha => !now.has(sha)); }
    catch { return; }
    if (!orphans.length) return;
    try { await this.storage.del(orphans.map(sha => workDocumentPath(this.sub, sha))); } catch { /* left for a later save */ }
  }
  async upload(documents) {
    const stored = [];
    for (const item of documents) {
      if (typeof item.text !== "string") { stored.push(item); continue; }
      const sha = sha256(item.text);
      await this.storage.put(workDocumentPath(this.sub, sha), item.text, { access: "private", addRandomSuffix: false,
        allowOverwrite: true, contentType: "text/plain; charset=utf-8" });
      stored.push({ id: item.id, slot: item.slot, name: item.name, sha, chars: item.text.length });
    }
    return stored;
  }
  /* A saved reference must already belong to this account's saved work;
     its length comes from there, never from the request. */
  resolve(documents, records, record) {
    const known = new Map(Object.values(records).filter(item => !item.deleted)
      .flatMap(item => item.documents || []).map(doc => [doc.sha, doc.chars]));
    const resolved = documents.map(item => {
      if (item.chars !== undefined) return item;
      if (!known.has(item.sha)) throw new HttpError(409, `${item.name} isn’t saved any more. Please add it again.`);
      return { id: item.id, slot: item.slot, name: item.name, sha: item.sha, chars: known.get(item.sha) };
    });
    if (resolved.reduce((sum, item) => sum + item.chars, 0) > WORK_LIMITS.recordDocumentChars)
      throw new HttpError(413, "These files are too long together. Remove one, or paste just the parts you need.");
    return { ...record, documents: resolved };
  }
  async save(record, base = null) {
    const { incomingChars, ...normalized } = normalizeWorkRecord(record); checkBase(base);
    if (incomingChars > WORK_LIMITS.recordDocumentChars)
      throw new HttpError(413, "These files are too long together. Remove one, or paste just the parts you need.");
    const incoming = normalized.documents;
    normalized.documents = await this.upload(incoming);
    const saved = await this.mutate(records => {
      const existing = records[normalized.id];
      if (existing?.deleted || (existing?.revision ?? null) !== base)
        throw new HttpError(409, "This was changed on another device.");
      // Older clients do not send kind; an edit must not turn a project
      // into a reusable task or attach a task-only check to it.
      if (existing?.kind === 'project') {
        if (normalized.workspaceId !== CUSTOM_WORKSPACE || normalized.check)
          throw new HttpError(400, "Projects use their own files and instructions, without a task check.");
        normalized.kind = 'project';
      }
      // A check result stays only while the details it was computed from are unchanged.
      const output = existing && sameCheck(existing.check, normalized.check) ? existing.output ?? null : null;
      const saved = { ...this.resolve(normalized.documents, records, normalized), revision: randomUUID(), updated: this.now(), output };
      return { records: { ...records, [saved.id]: saved }, result: saved };
    });
    await this.restore(incoming);
    return saved;
  }
  /* A delete elsewhere can remove shared text between this upload and the
     index write; writing it again once the index points at it closes that. */
  async restore(documents) {
    try { await this.upload(documents.filter(item => typeof item.text === "string")); }
    catch { /* the text was stored once already; a later save repairs it */ }
  }
  async run(id, base) {
    checkBase(base); const record = await this.record(id);
    if (record.revision !== base) throw new HttpError(409, "This changed on another device. Save it again, then try once more.");
    if (!record.check) throw new HttpError(400, "There’s nothing to work out here.");
    const execute = this.engine ?? (await import("./check-engine.js")).runCheck;
    let output;
    try { output = await execute(record.check.id, structuredClone(record.check.input), { now: this.now() }); }
    catch (error) {
      if (error instanceof HttpError) throw error;
      if (error?.name === "CheckInputError" && error.statusCode === 400)
        throw new HttpError(400, error.message);
      throw new HttpError(400, "Those answers couldn’t be checked. Look them over and try again.");
    }
    output = jsonValue(output, 64_000);
    if (!output || typeof output.status !== "string" || typeof output.summary !== "string" || !Array.isArray(output.limitations) || !Object.hasOwn(output, "result"))
      throw new HttpError(500, "Something went wrong working that out. Please try again.");
    const saved = { ...record, revision: randomUUID(), updated: this.now(), output };
    return this.mutate(records => {
      if (records[id]?.deleted || records[id]?.revision !== base)
        throw new HttpError(409, "This changed while Vaelo was working it out. Your newest changes are kept.");
      return { records: { ...records, [id]: saved }, result: saved };
    });
  }
  async delete(id, base) {
    checkWorkId(id); checkBase(base);
    const tombstone = { id, revision: randomUUID(), updated: this.now(), deleted: true };
    return this.mutate(records => {
      if (!records[id] || records[id].deleted) throw new HttpError(404, "This couldn’t be found. It may have been deleted.");
      if (records[id].revision !== base) throw new HttpError(409, "This changed on another device. Look at the newest version before deleting it.");
      return { records: { ...records, [id]: tombstone }, result: tombstone };
    });
  }
  async import(records) {
    if (!Array.isArray(records) || records.length < 1 || records.length > MAX_WORK_RECORDS)
      throw new HttpError(400, "A backup can hold 1 to 100 workspaces.");
    const normalized = records.map(item => normalizeWorkRecord(item));
    if (new Set(normalized.map(item => item.id)).size !== normalized.length) throw new HttpError(400, "Imported record identifiers must be unique.");
    const uploaded = [];
    for (const { incomingChars, ...item } of normalized) {
      if (incomingChars > WORK_LIMITS.recordDocumentChars) throw new HttpError(413, `“${item.title}” has too much in its files to load.`);
      uploaded.push({ ...item, documents: await this.upload(item.documents) });
    }
    const result = await this.mutate(current => {
      if (uploaded.some(item => Object.hasOwn(current, item.id))) throw new HttpError(409, "Some of these are already saved here. Open them from Saved instead.");
      const imported = uploaded.map(item => ({ ...this.resolve(item.documents, current, item), revision: randomUUID(), updated: this.now(), output: null }));
      return { records: { ...current, ...Object.fromEntries(imported.map(item => [item.id, item])) }, result: imported };
    });
    await this.restore(normalized.flatMap(item => item.documents));
    return result;
  }
  /* The text behind a record's documents, keyed by content hash. A missing
     file reads as null so the caller can say which one to attach again. */
  async documents(record) {
    const texts = {};
    for (const item of record.documents || []) {
      if (Object.hasOwn(texts, item.sha)) continue;
      const blob = await this.storage.get(workDocumentPath(this.sub, item.sha), { access: "private", useCache: false });
      texts[item.sha] = blob ? await new Response(blob.stream).text() : null;
    }
    return texts;
  }
}

export async function readWorkContext(sub, id, { storage } = {}) {
  if (!storage && !storageConfigured()) throw new HttpError(503, "Saving isn’t set up yet, so your work can’t be saved right now.");
  const store = new WorkStore(sub, storage);
  const record = await store.record(id);
  return { record, documents: await store.documents(record) };
}
