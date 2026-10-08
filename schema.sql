-- Schema for the D1 brute-force index used by the live demo.
--
-- The tenant column is indexed because it is a filter predicate on every read,
-- and because the isolation property depends on that filter running in SQL
-- rather than after scoring. See src/d1-index.ts.

CREATE TABLE IF NOT EXISTS vectors (
  id      TEXT PRIMARY KEY,
  tenant  TEXT    NOT NULL,
  doc_id  TEXT    NOT NULL,
  idx     INTEGER NOT NULL,
  text    TEXT    NOT NULL,
  vector  TEXT    NOT NULL   -- the embedding, as a JSON array
);

CREATE INDEX IF NOT EXISTS vectors_tenant     ON vectors (tenant);
CREATE INDEX IF NOT EXISTS vectors_tenant_doc ON vectors (tenant, doc_id);

-- Fixed-window rate limiting for the two routes that call Workers AI.
-- See src/ratelimit.ts for why the window is fixed and why it fails open.

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket     TEXT PRIMARY KEY,   -- route:caller:window_start
  hits       INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS rate_limits_expiry ON rate_limits (expires_at);
