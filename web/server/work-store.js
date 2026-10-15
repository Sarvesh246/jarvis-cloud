import { createHash, randomUUID } from "node:crypto";
import { get, put, BlobPreconditionFailedError } from "@vercel/blob";
import { HttpError } from "./security.js";

export const MAX_WORK_RECORDS = 100;
export const MAX_WORK_BYTES = 2_000_000;
export const MAX_WORK_INPUT_BYTES = 64_000;
const MAX_TOMBSTONES = 500;
const idPattern = /^[a-zA-Z0-9_-]{1,100}$/;
const scopes = new Set(["personal", "work", "client"]);
const forbidden = new Set(["__proto__", "prototype", "constructor"]);
const bytes = value => Buffer.byteLength(JSON.stringify(value));

export function checkWorkId(id) {
  if (typeof id !== "string" || !idPattern.test(id) || forbidden.has(id))
    throw new HttpError(400, "Invalid work record identifier.");
}
export function workAccountPath(sub) {
  if (typeof sub !== "string" || !sub) throw new HttpError(401, "Sign in to use Vaelo.");
  return `work/${createHash("sha256").update(sub).digest("hex")}/index.json`;
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
export function normalizeWorkRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) throw new HttpError(400, "Invalid work record.");
  checkWorkId(record.id);
  if (!Number.isInteger(record.capabilityId) || record.capabilityId < 1 || record.capabilityId > 36)
    throw new HttpError(400, "Choose a supported capability.");
  if (typeof record.title !== "string" || !record.title.trim() || record.title.length > 160)
    throw new HttpError(400, "A work title of up to 160 characters is required.");
  if (!record.input || typeof record.input !== "object" || Array.isArray(record.input))
    throw new HttpError(400, "Work input must be a JSON object.");
  const scope = record.scope ?? "personal";
  if (!scopes.has(scope)) throw new HttpError(400, "Choose personal, work, or client scope.");
  // Client-supplied output, revision, timestamps and deletion flags never cross this boundary.
  return { id: record.id, capabilityId: record.capabilityId, title: record.title.trim(),
    input: jsonValue(record.input, MAX_WORK_INPUT_BYTES), scope };
}

export class WorkStore {
  constructor(sub, storage = { get, put }, { engine, now = () => new Date().toISOString() } = {}) {
    this.path = workAccountPath(sub); this.storage = storage; this.engine = engine; this.now = now;
  }
  async snapshot() {
    const blob = await this.storage.get(this.path, { access: "private", useCache: false });
    if (!blob) return { records: {}, etag: null };
    const text = await new Response(blob.stream).text();
    if (Buffer.byteLength(text) > MAX_WORK_BYTES) throw new HttpError(503, "Stored work exceeds the supported size.");
    const data = JSON.parse(text);
    if (data.schemaVersion !== 1 || !data.records || typeof data.records !== "object" || Array.isArray(data.records))
      throw new HttpError(503, "Stored work could not be read safely.");
    return { records: data.records, etag: blob.blob.etag };
  }
  async list() {
    return Object.values((await this.snapshot()).records).filter(record => !record.deleted)
      .sort((a, b) => b.updated.localeCompare(a.updated));
  }
  async record(id) {
    checkWorkId(id);
    const record = (await this.snapshot()).records[id];
    if (!record || record.deleted) throw new HttpError(404, "Work record was not found.");
    return record;
  }
  async mutate(change) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const current = await this.snapshot();
      const { records, result } = change(current.records);
      const all = Object.values(records);
      if (all.filter(item => !item.deleted).length > MAX_WORK_RECORDS || all.filter(item => item.deleted).length > MAX_TOMBSTONES)
        throw new HttpError(413, "The work record limit has been reached. Export records before starting another workspace.");
      const text = JSON.stringify({ schemaVersion: 1, records });
      if (Buffer.byteLength(text) > MAX_WORK_BYTES) throw new HttpError(413, "Saved work has reached the storage limit.");
      try {
        await this.storage.put(this.path, text, { access: "private", addRandomSuffix: false,
          contentType: "application/json", allowOverwrite: Boolean(current.etag),
          ...(current.etag ? { ifMatch: current.etag } : {}) });
        return result;
      } catch (error) {
        if (!(error instanceof BlobPreconditionFailedError) && !/already exists/i.test(error.message)) throw error;
      }
    }
    throw new HttpError(409, "Work is syncing. Refresh and try again.");
  }
  async save(record, base = null) {
    const normalized = normalizeWorkRecord(record); checkBase(base);
    const saved = { ...normalized, revision: randomUUID(), updated: this.now(), output: null };
    return this.mutate(records => {
      const existing = records[saved.id];
      if (existing?.deleted || (existing?.revision ?? null) !== base)
        throw new HttpError(409, "This work record changed on another device. Refresh before saving.");
      return { records: { ...records, [saved.id]: saved }, result: saved };
    });
  }
  async run(id, base) {
    checkBase(base); const record = await this.record(id);
    if (record.revision !== base) throw new HttpError(409, "This work record changed. Save and run the current version.");
    const execute = this.engine ?? (await import("./capability-engine.js")).runCapability;
    let output;
    try { output = await execute(record.capabilityId, structuredClone(record.input), { now: this.now() }); }
    catch (error) {
      if (error instanceof HttpError) throw error;
      if (error?.name === "CapabilityInputError" && error.statusCode === 400)
        throw new HttpError(400, error.message);
      throw new HttpError(400, "These inputs could not be evaluated. Check the capability's input requirements.");
    }
    output = jsonValue(output, 64_000);
    if (!output || typeof output.status !== "string" || typeof output.summary !== "string" || !Array.isArray(output.limitations) || !Object.hasOwn(output, "result"))
      throw new HttpError(500, "The capability did not return a valid result.");
    const saved = { ...record, revision: randomUUID(), updated: this.now(), output };
    return this.mutate(records => {
      if (records[id]?.deleted || records[id]?.revision !== base)
        throw new HttpError(409, "This work record changed while running. The newer edit was preserved.");
      return { records: { ...records, [id]: saved }, result: saved };
    });
  }
  async delete(id, base) {
    checkWorkId(id); checkBase(base);
    const tombstone = { id, revision: randomUUID(), updated: this.now(), deleted: true };
    return this.mutate(records => {
      if (!records[id] || records[id].deleted) throw new HttpError(404, "Work record was not found.");
      if (records[id].revision !== base) throw new HttpError(409, "This work record changed. Refresh before deleting.");
      return { records: { ...records, [id]: tombstone }, result: tombstone };
    });
  }
  async import(records) {
    if (!Array.isArray(records) || records.length < 1 || records.length > MAX_WORK_RECORDS)
      throw new HttpError(400, "Import between 1 and 100 work records.");
    const normalized = records.map(normalizeWorkRecord);
    if (new Set(normalized.map(item => item.id)).size !== normalized.length) throw new HttpError(400, "Imported record identifiers must be unique.");
    const imported = normalized.map(item => ({ ...item, revision: randomUUID(), updated: this.now(), output: null }));
    return this.mutate(current => {
      if (imported.some(item => Object.hasOwn(current, item.id))) throw new HttpError(409, "An imported identifier already exists. Choose new identifiers before importing.");
      return { records: { ...current, ...Object.fromEntries(imported.map(item => [item.id, item])) }, result: imported };
    });
  }
}

export async function readWorkContext(sub, id, { storage, maxCharacters = 12_000 } = {}) {
  if (!storage && !process.env.BLOB_READ_WRITE_TOKEN) throw new HttpError(503, "Work storage is not configured.");
  const record = await new WorkStore(sub, storage).record(id);
  const text = JSON.stringify({ id: record.id, capabilityId: record.capabilityId, title: record.title,
    scope: record.scope, revision: record.revision, input: record.input, output: record.output });
  if (text.length > maxCharacters)
    throw new HttpError(413, "This work record is too large for chat context. Narrow its inputs before attaching it.");
  return text;
}
