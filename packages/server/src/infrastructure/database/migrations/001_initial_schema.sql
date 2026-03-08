-- 001_initial_schema.sql
-- Core tables for multi-user Fleex with JSONB for schema flexibility.

CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT UNIQUE NOT NULL,
  name        TEXT,
  avatar_url  TEXT,
  provider    TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  preferences JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(provider, provider_id)
);

-- Seed a default user for single-user / local-dev setups.
INSERT INTO users (id, email, name, provider, provider_id)
VALUES ('00000000-0000-0000-0000-000000000000', 'local@localhost', 'Local User', 'local', 'local')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS gateways (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  hostname      TEXT,
  public_key    TEXT,
  secret_hash   TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'offline',
  last_seen_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gateways_user ON gateways(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_gateways_public_key ON gateways(public_key);

CREATE TABLE IF NOT EXISTS boards (
  id          UUID PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  data        JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_boards_user ON boards(user_id);

CREATE TABLE IF NOT EXISTS tickets (
  id          UUID PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  board_id    UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'backlog',
  data        JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tickets_user_board ON tickets(user_id, board_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(user_id, status);

CREATE TABLE IF NOT EXISTS ticket_activity (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ticket_id   UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  data        JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_activity_ticket ON ticket_activity(ticket_id, created_at DESC);

CREATE TABLE IF NOT EXISTS sessions (
  id          UUID PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gateway_id  UUID REFERENCES gateways(id) ON DELETE SET NULL,
  data        JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_gw ON sessions(user_id, gateway_id);

CREATE TABLE IF NOT EXISTS user_kv (
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS api_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  prefix        TEXT NOT NULL,
  hashed_secret TEXT NOT NULL,
  scopes        TEXT[] NOT NULL DEFAULT '{}',
  last_used_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tokens_hash ON api_tokens(hashed_secret);

-- Migration tracking table.
CREATE TABLE IF NOT EXISTS _migrations (
  name       TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
