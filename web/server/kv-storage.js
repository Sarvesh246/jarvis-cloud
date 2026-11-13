import { randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";

/* A small key/value store on Postgres that mirrors the slice of @vercel/blob
   the stores use (get, put, del with ifMatch / allowOverwrite). Blob bills per
   operation and its free tier ran out; a database row costs nothing per read. */

const databaseUrl = () => process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
export const storageConfigured = () => Boolean(databaseUrl());

export class PreconditionFailedError extends Error {
  constructor() { super("The stored value changed."); this.name = "PreconditionFailedError"; }
}
// Also recognises the Blob error so injected test storage keeps working.
export const isConflict = error =>
  /PreconditionFailed/.test(error?.name || "") || /already exists/i.test(error?.message || "");

let client = null;
let ready = null;
function database() {
  const url = databaseUrl();
  if (!url) throw new Error("DATABASE_URL is not set.");
  client ??= neon(url);
  ready ??= process.env.VAELO_SCHEMA_MANAGED === "1" ? Promise.resolve() : client.query(`CREATE TABLE IF NOT EXISTS kv_store (
    path text PRIMARY KEY, body text NOT NULL, etag text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now())`, [], { fetchOptions: { signal: AbortSignal.timeout(5000) } }).catch(error => { ready = null; throw error; });
  return { sql: client, ready };
}

export async function get(path, {signal = AbortSignal.timeout(5000)} = {}) {
  const { sql, ready } = database(); await ready;
  const [row] = await sql.query("SELECT body, etag FROM kv_store WHERE path = $1", [path], {fetchOptions:{signal}});
  if (!row) return null;
  return { statusCode: 200, stream: new Response(row.body).body, blob: { etag: row.etag } };
}

export async function put(path, body, options = {}) {
  const { sql, ready } = database(); await ready;
  const queryOptions = { fetchOptions: { signal: options.signal || AbortSignal.timeout(5000) } };
  const text = typeof body === "string" ? body : String(body);
  const etag = randomUUID();
  if (options.ifMatch) {
    const rows = await sql.query(
      "UPDATE kv_store SET body = $2, etag = $3, updated_at = now() WHERE path = $1 AND etag = $4 RETURNING etag",
      [path, text, etag, options.ifMatch], queryOptions);
    if (!rows.length) throw new PreconditionFailedError();
  } else if (options.allowOverwrite) {
    await sql.query(`INSERT INTO kv_store (path, body, etag) VALUES ($1, $2, $3)
      ON CONFLICT (path) DO UPDATE SET body = EXCLUDED.body, etag = EXCLUDED.etag, updated_at = now()`,
    [path, text, etag], queryOptions);
  } else {
    const rows = await sql.query(
      "INSERT INTO kv_store (path, body, etag) VALUES ($1, $2, $3) ON CONFLICT (path) DO NOTHING RETURNING etag",
      [path, text, etag], queryOptions);
    if (!rows.length) throw new Error("This value already exists.");
  }
  return { pathname: path, etag };
}

export async function del(paths) {
  const list = Array.isArray(paths) ? paths : [paths];
  if (!list.length) return;
  const { sql, ready } = database(); await ready;
  await sql.query("DELETE FROM kv_store WHERE path = ANY($1)", [list], {fetchOptions:{signal:AbortSignal.timeout(5000)}});
}

// Fetch an immutable revision with one round trip, preserving caller order.
export async function getMany(paths, { signal = AbortSignal.timeout(5000) } = {}) {
  const { sql, ready } = database(); await ready;
  const rows = await sql.query("SELECT path, body FROM kv_store WHERE path = ANY($1)", [paths], { fetchOptions: { signal } });
  const byPath = new Map(rows.map(row => [row.path, row.body]));
  return paths.map(path => byPath.has(path) ? JSON.parse(byPath.get(path)) : null);
}
