import { neon } from "@neondatabase/serverless";

// One row per accepted relay attempt, including tool rounds reported by Hermes.
// No prompts, answers, account identifiers, or provider credentials are stored.
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
  if (!Number.isFinite(at.valueOf()) || at.valueOf() > Date.now() + 300_000)
    throw new Error("Invalid usage date.");
  return { id: body.id, route: body.route, reported: body.reported,
    input: body.input, output: body.output, cached: body.cached, at: at.toISOString() };
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
      .catch(error => { this.ready = null; throw error; });
    await this.ready;
  }
  async record(body) {
    const e = validateUsage(body);
    await this.initialize();
    // Identical retries are harmless; later delivery of reported usage may fill a gap.
    await this.sql.query(`INSERT INTO usage_events
      (id, route, reported, input_tokens, output_tokens, cached_tokens, happened_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (id) DO UPDATE SET
        reported = usage_events.reported OR EXCLUDED.reported,
        input_tokens = GREATEST(usage_events.input_tokens, EXCLUDED.input_tokens),
        output_tokens = GREATEST(usage_events.output_tokens, EXCLUDED.output_tokens),
        cached_tokens = GREATEST(usage_events.cached_tokens, EXCLUDED.cached_tokens)`,
    [e.id, e.route, e.reported, e.input, e.output, e.cached, e.at]);
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
    const [coverage] = await this.sql.query("SELECT min(happened_at) AS since FROM usage_events");
    const routes = rows.map(r => ({ ...r, input: Number(r.input), output: Number(r.output), cached: Number(r.cached) }));
    const sum = key => routes.reduce((n, r) => n + Number(r[key]), 0);
    return { month, input: sum("input"), output: sum("output"), cached: sum("cached"),
      total: sum("input") + sum("output"), attempts: sum("attempts"), unreported: sum("unreported"),
      since: coverage.since, routes, checkedAt: new Date().toISOString() };
  }
}
