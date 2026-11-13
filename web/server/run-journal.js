import { createHash, timingSafeEqual } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { readJson, json, HttpError } from "./security.js";

let sql, ready;
async function database() {
  sql ??= neon(process.env.DATABASE_URL || process.env.POSTGRES_URL);
  ready ??= process.env.VAELO_SCHEMA_MANAGED === "1" ? Promise.resolve() : sql.query(`CREATE TABLE IF NOT EXISTS reply_runs (
    account text NOT NULL, id text NOT NULL, created double precision NOT NULL,
    done boolean NOT NULL DEFAULT false, outcome text NOT NULL DEFAULT 'running',
    updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(account,id));`).then(() =>
    sql.query(`CREATE TABLE IF NOT EXISTS reply_frames (
      account text NOT NULL, id text NOT NULL, seq integer NOT NULL, frame text NOT NULL,
      PRIMARY KEY(account,id,seq), FOREIGN KEY(account,id) REFERENCES reply_runs(account,id) ON DELETE CASCADE)`))
    .catch(error => { ready = null; throw error; });
  await ready; return sql;
}
export function journalAuthorized(req) {
  const key = process.env.RUN_STORE_KEY;
  if (!key || key.length < 32) return false;
  const actual = Buffer.from(req.headers.authorization || ""), expected = Buffer.from(`Bearer ${key}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export async function runJournalApi(req, res) {
  if (!journalAuthorized(req)) throw new HttpError(401, "Authentication required.");
  const body = await readJson(req, 3_000_000);
  if (!/^[a-f0-9-]{36}$/.test(body?.id || "") || typeof body.owner !== "string" || !/^web:[^\r\n]{1,250}$/.test(body.owner)) throw new HttpError(400, "Invalid run.");
  const owner = createHash("sha256").update(body.owner).digest("hex"), db = await database();
  const query = (text, values) => db.query(text, values, { fetchOptions: { signal: AbortSignal.timeout(5000) } });
  if (body.action === "create") {
    if (!Number.isFinite(body.created)) throw new HttpError(400, "Invalid run.");
    await query("INSERT INTO reply_runs(account,id,created) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [owner,body.id,body.created]);
    return json(res, 200, { ok: true });
  }
  if (body.action === "read") {
    if (!Number.isInteger(body.after) || body.after < -1) throw new HttpError(400, "Invalid cursor.");
    const [run] = await query("SELECT created,done,outcome,(SELECT max(seq) FROM reply_frames f WHERE f.account=reply_runs.account AND f.id=reply_runs.id) AS last_seq FROM reply_runs WHERE account=$1 AND id=$2 AND updated_at > now()-interval '1 hour'",[owner,body.id]);
    if (!run) return json(res, 200, { run: null });
    // Small pages keep both request and response under the hosting limits.
    const frames = await query("WITH page AS (SELECT seq,frame,sum(octet_length(frame)) OVER (ORDER BY seq) AS bytes FROM reply_frames WHERE account=$1 AND id=$2 AND seq>$3) SELECT seq,frame FROM page WHERE bytes<=2000000 ORDER BY seq LIMIT 32", [owner,body.id,body.after]);
    return json(res, 200, { run, frames, more: frames.length > 0 && frames.at(-1).seq < run.last_seq });
  }
  if (body.action === "append") {
    if (!Array.isArray(body.frames) || body.frames.some(item => !Number.isInteger(item.seq) || item.seq < 0 || item.seq > 1000000 || typeof item.frame !== "string" || item.frame.length > 1_000_000) ||
        typeof body.done !== "boolean" || !["running","complete","stopped","error"].includes(body.outcome)) throw new HttpError(400, "Invalid frames.");
    await db.transaction([
      db.query(`INSERT INTO reply_frames(account,id,seq,frame) SELECT $1,$2,(x->>'seq')::integer,x->>'frame' FROM jsonb_array_elements($3::jsonb) x ON CONFLICT DO NOTHING`, [owner,body.id,JSON.stringify(body.frames)]),
      db.query(`UPDATE reply_runs SET done=done OR $3,outcome=CASE WHEN done THEN outcome ELSE $4 END,updated_at=now() WHERE account=$1 AND id=$2`,[owner,body.id,body.done,body.outcome]),
    ], { fetchOptions: { signal: AbortSignal.timeout(5000) } });
    return json(res, 200, { ok: true });
  }
  throw new HttpError(400, "Invalid journal action.");
}

// Scheduled cleanup covers transient run events only. Saved conversations,
// workspace documents and account preferences are never touched here.
export async function cleanupRunJournal(req, res) {
  const key = process.env.CRON_SECRET;
  const actual = Buffer.from(req.headers.authorization || ""), expected = Buffer.from(`Bearer ${key || ""}`);
  if (!key || key.length < 32 || actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new HttpError(401, "Authentication required.");
  const db = await database();
  const removed = await db.query("DELETE FROM reply_runs WHERE updated_at < now()-interval '1 hour' RETURNING id", [], { fetchOptions: { signal: AbortSignal.timeout(5000) } });
  return json(res, 200, { removed: removed.length });
}
