import { neon } from "@neondatabase/serverless";
import { createHash } from 'node:crypto';

export const usageAccount = sub => createHash('sha256').update(`web:${sub}`).digest('hex');

// One row per accepted relay attempt, including tool rounds reported by Hermes.
// Only a one-way account key accompanies counters. No content or credentials.
export function validateUsage(body) {
  if (!body || !/^[a-zA-Z0-9_-]{8,80}$/.test(body.id || "") ||
      !/^[a-z0-9_-]{1,40}$/.test(body.route || "") || typeof body.reported !== "boolean")
    throw new Error("Invalid usage event.");
  for (const key of ["input", "output", "cached"])
    if (!Number.isSafeInteger(body[key]) || body[key] < 0 || body[key] > 1e10)
      throw new Error("Invalid token count.");
  if (!body.reported && (body.input || body.output || body.cached))
    throw new Error("Unreported usage cannot contain token counts.");
  const at = new Date(body.at);
  if (body.account !== undefined && !/^[a-f0-9]{64}$/.test(body.account)) throw new Error('Invalid usage account.');
  if (!Number.isFinite(at.valueOf()) || at.valueOf() > Date.now() + 300_000)
    throw new Error("Invalid usage date.");
  return { id: body.id, route: body.route, reported: body.reported,
    input: body.input, output: body.output, cached: body.cached, at: at.toISOString(), account: body.account || null };
}

export class UsageStore {
  constructor(sql = neon(process.env.DATABASE_URL || process.env.POSTGRES_URL || "")) {
    this.sql = sql;
    this.ready = null;
  }
  async initialize() {
    this.ready ??= this.sql.query(`CREATE TABLE IF NOT EXISTS usage_events (
      id text PRIMARY KEY, route text NOT NULL, reported boolean NOT NULL,
      input_tokens bigint NOT NULL, output_tokens bigint NOT NULL, cached_tokens bigint NOT NULL,
      happened_at timestamptz NOT NULL, received_at timestamptz NOT NULL DEFAULT now())`)
      .then(() => this.sql.query("CREATE INDEX IF NOT EXISTS usage_events_time ON usage_events (happened_at)"))
      .then(() => this.sql.query('ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS account_key text'))
      .then(() => this.sql.query('CREATE INDEX IF NOT EXISTS usage_events_account_time ON usage_events (account_key, happened_at)'))
      .catch(error => { this.ready = null; throw error; });
    await this.ready;
  }
  async record(body) {
    const e = validateUsage(body);
    await this.initialize();
    // Identical retries are harmless; later delivery of reported usage may fill a gap.
    await this.sql.query(`INSERT INTO usage_events
      (id, route, reported, input_tokens, output_tokens, cached_tokens, happened_at, account_key)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (id) DO UPDATE SET
        reported = usage_events.reported OR EXCLUDED.reported,
        input_tokens = GREATEST(usage_events.input_tokens, EXCLUDED.input_tokens),
        output_tokens = GREATEST(usage_events.output_tokens, EXCLUDED.output_tokens),
        cached_tokens = GREATEST(usage_events.cached_tokens, EXCLUDED.cached_tokens),
        account_key = COALESCE(usage_events.account_key, EXCLUDED.account_key)
      WHERE usage_events.account_key IS NULL OR EXCLUDED.account_key IS NULL
        OR usage_events.account_key = EXCLUDED.account_key`,
    [e.id, e.route, e.reported, e.input, e.output, e.cached, e.at, e.account]);
  }
  async accountSummary(sub, range = 'month', now = new Date()) {
    if (!['today', 'month', 'all'].includes(range)) throw new Error('Choose today, month or all.');
    await this.initialize();
    const key = usageAccount(sub);
    const from = range === 'all' ? '1970-01-01T00:00:00Z' : range === 'today'
      ? now.toISOString().slice(0, 10) + 'T00:00:00Z' : now.toISOString().slice(0, 7) + '-01T00:00:00Z';
    const [row] = await this.sql.query(`SELECT count(*)::int AS attempts,
      count(*) FILTER (WHERE NOT reported)::int AS unreported,
      COALESCE(sum(input_tokens),0)::text AS input,
      COALESCE(sum(output_tokens),0)::text AS output,
      COALESCE(sum(cached_tokens),0)::text AS cached,
      max(happened_at) AS latest FROM usage_events
      WHERE account_key = $1 AND happened_at >= $2::timestamptz AND happened_at <= $3::timestamptz`, [key, from, now.toISOString()]);
    const [coverage] = await this.sql.query('SELECT min(happened_at) AS since FROM usage_events WHERE account_key = $1', [key]);
    const input = Number(row?.input || 0), output = Number(row?.output || 0);
    return { range, input, output, cached: Number(row?.cached || 0), total: input + output,
      attempts: Number(row?.attempts || 0), unreported: Number(row?.unreported || 0),
      since: coverage?.since || null, latest: row?.latest || null, checkedAt: now.toISOString(), timezone: 'UTC' };
  }
  async summary(month) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Invalid usage month.");
    await this.initialize();
    const rows = await this.sql.query(`SELECT route, count(*)::int AS attempts,
      count(*) FILTER (WHERE NOT reported)::int AS unreported,
      COALESCE(sum(input_tokens),0)::text AS input,
      COALESCE(sum(output_tokens),0)::text AS output,
      COALESCE(sum(cached_tokens),0)::text AS cached,
      max(happened_at) AS latest
      FROM usage_events WHERE happened_at >= $1::timestamptz
        AND happened_at < $1::timestamptz + interval '1 month' GROUP BY route`, [month + "-01T00:00:00Z"]);
    const [coverage] = await this.sql.query(`SELECT min(happened_at) AS since,
      min(happened_at) FILTER (WHERE id NOT LIKE 'history-%') AS live_since,
      COALESCE(sum(input_tokens + output_tokens) FILTER (WHERE id LIKE 'history-%'
        AND happened_at >= $1::timestamptz AND happened_at < $1::timestamptz + interval '1 month'), 0)::text AS historical_tokens
      FROM usage_events`, [month + "-01T00:00:00Z"]);
    const routes = rows.map(r => ({ ...r, input: Number(r.input), output: Number(r.output), cached: Number(r.cached) }));
    const sum = key => routes.reduce((n, r) => n + Number(r[key]), 0);
    return { month, input: sum("input"), output: sum("output"), cached: sum("cached"),
      total: sum("input") + sum("output"), attempts: sum("attempts"), unreported: sum("unreported"),
      since: coverage.since, liveSince: coverage.live_since || null,
      historicalTokens: Number(coverage.historical_tokens || 0), routes, checkedAt: new Date().toISOString() };
  }
}
