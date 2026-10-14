import { createHash, randomUUID } from "node:crypto";
import { get, put, del, BlobPreconditionFailedError } from "@vercel/blob";
import { HttpError } from "./security.js";

export const PART_SIZE = 500_000;
export const MAX_PARTS = 128;
const validId = (id) => typeof id === "string" && /^[\w-]{1,100}$/.test(id) &&
  !["__proto__", "constructor", "prototype"].includes(id);
export function checkId(id) {
  if (!validId(id)) throw new HttpError(400, "Invalid conversation identifier.");
}
export function accountPath(sub) {
  return `chats/${createHash("sha256").update(sub).digest("hex")}`;
}

export class ChatStore {
  constructor(sub, storage = { get, put, del }) {
    this.prefix = accountPath(sub);
    this.storage = storage;
  }
  async read(path) {
    const result = await this.storage.get(path, { access: "private", useCache: false });
    if (!result) return null;
    return { data: await new Response(result.stream).json(), etag: result.blob.etag };
  }
  async manifest() {
    return (await this.read(`${this.prefix}/index.json`)) || {
      data: { entries: {} }, etag: null,
    };
  }
  partPath(id, version, part) {
    checkId(id); checkId(version);
    if (!Number.isInteger(part) || part < 0 || part >= MAX_PARTS)
      throw new HttpError(400, "Invalid conversation part.");
    return `${this.prefix}/${id}/${version}/${part}.json`;
  }
  async stage({ id, version, part, text }) {
    const path = this.partPath(id, version, part);
    if (typeof text !== "string" || text.length > PART_SIZE)
      throw new HttpError(413, "Conversation part is too large.");
    // Parts are immutable. A retried request may have already succeeded.
    try {
      await this.storage.put(path, JSON.stringify(text), {
        access: "private", addRandomSuffix: false, allowOverwrite: false,
        contentType: "application/json",
      });
    } catch (error) {
      const existing = await this.read(path);
      if (!existing || existing.data !== text) throw error;
    }
  }
  async part(id, version, part) {
    const result = await this.read(this.partPath(id, version, part));
    if (!result) throw new HttpError(404, "Conversation part was not found.");
    return result.data;
  }
  async commit({ id, version, base = null, parts, deleted = false }) {
    checkId(id); checkId(version);
    if (base !== null) checkId(base);
    if (typeof deleted !== "boolean") throw new HttpError(400, "Invalid change.");
    if (!deleted) {
      if (!Number.isInteger(parts) || parts < 1 || parts > MAX_PARTS)
        throw new HttpError(400, "Invalid conversation size.");
      const chunks = [];
      for (let i = 0; i < parts; i++) chunks.push(await this.part(id, version, i));
      let chat;
      try { chat = JSON.parse(chunks.join("")); } catch {
        throw new HttpError(400, "Invalid conversation data.");
      }
      if (chat?.id !== id || !Array.isArray(chat.messages) || typeof chat.title !== "string")
        throw new HttpError(400, "Invalid conversation data.");
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      const current = await this.manifest();
      const entry = current.data.entries[id];
      if (entry?.version === version) return entry; // Idempotent after a lost response.
      if ((entry?.version || null) !== base)
        throw new HttpError(409, "This conversation changed on another device.");
      const next = { version, deleted, parts: deleted ? 0 : parts, updated: Date.now() };
      try {
        await this.storage.put(`${this.prefix}/index.json`, JSON.stringify({
          entries: { ...current.data.entries, [id]: next }, nonce: randomUUID(),
        }), {
          access: "private", addRandomSuffix: false, contentType: "application/json",
          allowOverwrite: Boolean(current.etag), ...(current.etag ? { ifMatch: current.etag } : {}),
        });
        // Readers of a replaced revision retry on their next sync pass. Cleanup
        // happens only after the replacement is durably published.
        if (entry?.parts && this.storage.del) {
          await this.storage.del(Array.from({ length: entry.parts }, (_, part) =>
            this.partPath(id, entry.version, part))).catch(() => {});
        }
        return next;
      } catch (error) {
        // The first create also races safely: allowOverwrite:false is atomic.
        if (!(error instanceof BlobPreconditionFailedError) &&
            !/already exists/i.test(error.message)) throw error;
      }
    }
    throw new HttpError(409, "Conversations are syncing. Please try again.");
  }
}
