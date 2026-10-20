import { PreconditionFailedError } from "../server/kv-storage.js";

/* An in-memory stand-in for the kv_store, with the same compare-and-swap rules. */
export function memoryStorage() {
  const rows = new Map(); let serial = 0;
  return {
    rows,
    async get(path) {
      const row = rows.get(path);
      return row ? { stream: new Response(row.text).body, blob: { etag: row.etag } } : null;
    },
    async put(path, text, options = {}) {
      const row = rows.get(path);
      if ((options.ifMatch && row?.etag !== options.ifMatch) || (!options.allowOverwrite && row))
        throw new PreconditionFailedError();
      rows.set(path, { text, etag: String(++serial) });
    },
  };
}

/* A response object that records what the handler sent. */
export function reply() {
  const out = { headers: {}, statusCode: 200 };
  out.setHeader = (key, value) => { out.headers[key] = value; };
  out.end = text => { out.body = text ? JSON.parse(text) : null; };
  return out;
}
