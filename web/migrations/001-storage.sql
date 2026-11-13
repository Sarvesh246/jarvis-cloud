CREATE TABLE IF NOT EXISTS kv_store (
  path text PRIMARY KEY, body text NOT NULL, etag text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS conversation_recall (
  account text NOT NULL, chat_id text NOT NULL, version text NOT NULL,
  title text NOT NULL, excerpts jsonb NOT NULL, document tsvector NOT NULL,
  updated bigint NOT NULL, PRIMARY KEY(account,chat_id));
CREATE INDEX IF NOT EXISTS conversation_recall_search ON conversation_recall USING gin(document);
CREATE TABLE IF NOT EXISTS usage_events (
  id text PRIMARY KEY, route text NOT NULL, reported boolean NOT NULL,
  input_tokens bigint NOT NULL, output_tokens bigint NOT NULL, cached_tokens bigint NOT NULL,
  happened_at timestamptz NOT NULL, received_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS account_key text;
CREATE INDEX IF NOT EXISTS usage_events_time ON usage_events(happened_at);
CREATE INDEX IF NOT EXISTS usage_events_account_time ON usage_events(account_key,happened_at);
CREATE TABLE IF NOT EXISTS reply_runs (
  account text NOT NULL, id text NOT NULL, created double precision NOT NULL,
  done boolean NOT NULL DEFAULT false, outcome text NOT NULL DEFAULT 'running',
  updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(account,id));
CREATE TABLE IF NOT EXISTS reply_frames (
  account text NOT NULL, id text NOT NULL, seq integer NOT NULL, frame text NOT NULL,
  PRIMARY KEY(account,id,seq), FOREIGN KEY(account,id) REFERENCES reply_runs(account,id) ON DELETE CASCADE);
