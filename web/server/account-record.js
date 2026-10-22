import { createHash } from "node:crypto";
import { get, put, isConflict } from "./kv-storage.js";
import { HttpError } from "./http-error.js";

/* One small JSON record per account and kind (devices, memory, retention),
   kept in the same kv_store as everything else. Reads fail closed: a record
   that can't be read or doesn't look right throws, and nothing is written
   over it. Writes are compare-and-swap, so two instances changing the same
   record can't silently undo each other. */
export const recordPath = (kind, sub) =>
  `${kind}/${createHash("sha256").update(sub).digest("hex")}.json`;

export class AccountRecord {
  constructor(kind, { empty, check }, storage = { get, put }) {
    Object.assign(this, { kind, empty, check, storage });
  }

  async read(sub, {signal} = {}) {
    const result = await this.storage.get(recordPath(this.kind, sub), { access: "private", useCache: false, signal });
    if (!result) return { data: this.empty(), etag: null };
    return { data: this.check(await new Response(result.stream).json()), etag: result.blob.etag };
  }

  /* `change` gets a copy of the record and returns the new one, or undefined
     to leave it alone. It may throw (an HttpError) to refuse the change. */
  async update(sub, change) {
    const path = recordPath(this.kind, sub);
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data, etag } = await this.read(sub);
      const next = change(structuredClone(data));
      if (next === undefined) return data;
      try {
        await this.storage.put(path, JSON.stringify(this.check(next)), {
          access: "private", addRandomSuffix: false, contentType: "application/json",
          allowOverwrite: Boolean(etag), ...(etag ? { ifMatch: etag } : {}),
        });
        return next;
      } catch (error) {
        if (!isConflict(error)) throw error;
      }
    }
    throw new HttpError(409, "That changed on another device. Try again.");
  }
}
