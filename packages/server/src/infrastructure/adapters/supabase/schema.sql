-- ============================================================================
-- Fleex – Supabase Schema (REFERENCE FILE)
-- Run this in the Supabase SQL Editor to create all required tables and indexes.
--
-- NOTE: The canonical schema is now managed by the migration system at:
--   packages/server/src/infrastructure/migrations/
-- This file is kept as a convenience for Supabase SQL Editor users.
-- ============================================================================

-- ── Users ─────────────────────────────────────────────────────────────────

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

-- ── Sessions ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  tmux_name     TEXT NOT NULL,
  type          TEXT NOT NULL,
  status        TEXT NOT NULL,
  cwd           TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL,
  last_attached_at TIMESTAMPTZ,
  repository_org   TEXT,
  repository_name  TEXT,
  worktree_branch  TEXT,
  git_remote       TEXT,
  claude_prompt    TEXT,
  display_name     TEXT
);

-- ── Boards ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS boards (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  emoji           TEXT NOT NULL,
  next_display_id INTEGER NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL
);

-- ── Tickets ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tickets (
  id                TEXT PRIMARY KEY,
  board_id          TEXT NOT NULL,
  display_id        INTEGER NOT NULL DEFAULT 0,
  title             TEXT NOT NULL,
  description       TEXT NOT NULL,
  status            TEXT NOT NULL,
  priority          TEXT NOT NULL,
  position          INTEGER NOT NULL,
  tags              JSONB NOT NULL DEFAULT '[]',
  links             JSONB NOT NULL DEFAULT '[]',
  blocked           BOOLEAN NOT NULL DEFAULT FALSE,
  favorite          BOOLEAN NOT NULL DEFAULT FALSE,
  due_date          TIMESTAMPTZ,
  assignee          TEXT,
  agent_claimed_at  TIMESTAMPTZ,
  github_metadata   JSONB,
  status_changed_at TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL,
  updated_at        TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tickets_board_id ON tickets(board_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status   ON tickets(status);

-- ── Ticket Activities ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ticket_activities (
  id          TEXT PRIMARY KEY,
  ticket_id   TEXT NOT NULL,
  action      TEXT NOT NULL,
  changes     JSONB NOT NULL DEFAULT '{}',
  actor_type  TEXT NOT NULL,
  actor_name  TEXT,
  source      TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ticket_activities_ticket_id ON ticket_activities(ticket_id);

-- ── API Tokens ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS api_tokens (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  prefix        TEXT NOT NULL,
  hashed_secret TEXT NOT NULL,
  last_used_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_api_tokens_hashed_secret ON api_tokens(hashed_secret);

-- ── Comments ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS comments (
  id                  TEXT PRIMARY KEY,
  ticket_id           TEXT NOT NULL,
  author_type         TEXT NOT NULL,
  author_name         TEXT NOT NULL,
  body                TEXT NOT NULL,
  visibility          TEXT NOT NULL,
  private_recipients  JSONB NOT NULL DEFAULT '[]',
  mentions            JSONB NOT NULL DEFAULT '[]',
  parent_id           TEXT,
  created_at          TIMESTAMPTZ NOT NULL,
  updated_at          TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_comments_ticket_id ON comments(ticket_id);

-- ── Mentions ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mentions (
  id                      TEXT PRIMARY KEY,
  ticket_id               TEXT NOT NULL,
  comment_id              TEXT NOT NULL,
  target_agent            TEXT NOT NULL,
  source_agent            TEXT NOT NULL,
  status                  TEXT NOT NULL,
  resolved_at             TIMESTAMPTZ,
  resolved_comment_id     TEXT,
  resolved_deliverable_id TEXT,
  created_at              TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mentions_ticket_id           ON mentions(ticket_id);
CREATE INDEX IF NOT EXISTS idx_mentions_status              ON mentions(status);
CREATE INDEX IF NOT EXISTS idx_mentions_target_agent_status ON mentions(target_agent, status);
CREATE INDEX IF NOT EXISTS idx_mentions_comment_id          ON mentions(comment_id);

-- ── Deliverables ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS deliverables (
  id          TEXT PRIMARY KEY,
  ticket_id   TEXT NOT NULL,
  agent_name  TEXT NOT NULL,
  type        TEXT NOT NULL,
  title       TEXT NOT NULL,
  content     TEXT NOT NULL,
  version     INTEGER NOT NULL DEFAULT 1,
  status      TEXT NOT NULL DEFAULT 'draft',
  mention_id  TEXT,
  created_at  TIMESTAMPTZ NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_deliverables_ticket_id ON deliverables(ticket_id);

-- ── Agent Personas ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agent_personas (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL UNIQUE,
  display_name       TEXT NOT NULL,
  model              TEXT NOT NULL,
  soul_md            TEXT NOT NULL DEFAULT '',
  identity_md        TEXT NOT NULL DEFAULT '',
  memory_md          TEXT NOT NULL DEFAULT '',
  human_mention_name TEXT,
  created_at         TIMESTAMPTZ NOT NULL,
  updated_at         TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_personas_name ON agent_personas(name);

-- ── Skills ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS skills (
  id                TEXT PRIMARY KEY,
  command_name      TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  display_name      TEXT NOT NULL,
  markdown_content  TEXT NOT NULL DEFAULT '',
  enabled           BOOLEAN NOT NULL DEFAULT TRUE,
  persona_id        TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL,
  updated_at        TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_skills_command_name ON skills(command_name);
CREATE INDEX IF NOT EXISTS idx_skills_persona_id ON skills(persona_id);

-- ── Agent Event Executions ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agent_event_executions (
  execution_id  TEXT PRIMARY KEY,
  persona_id    TEXT NOT NULL,
  ticket_id     TEXT NOT NULL,
  mention_id    TEXT NOT NULL,
  event_count   INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'running',
  started_at    TIMESTAMPTZ NOT NULL,
  completed_at  TIMESTAMPTZ,
  sdk_session_id TEXT,
  last_event_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agent_executions_ticket  ON agent_event_executions(ticket_id);
CREATE INDEX IF NOT EXISTS idx_agent_executions_persona ON agent_event_executions(persona_id);

-- ── Domain Event Log ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS domain_event_log (
  id          TEXT PRIMARY KEY,
  event_type  TEXT NOT NULL,
  payload     JSONB NOT NULL,
  instance_id TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_domain_event_log_occurred_at ON domain_event_log(occurred_at);
CREATE INDEX IF NOT EXISTS idx_domain_event_log_event_type ON domain_event_log(event_type);

-- ── Row-Level Security ──────────────────────────────────────────────────────
-- Enable RLS on all tables and add permissive policies for the service role.

ALTER TABLE users             ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE boards            ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets           ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_tokens        ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE mentions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE deliverables      ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_personas    ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_users"             ON users             FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_sessions"          ON sessions          FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_boards"            ON boards            FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_tickets"           ON tickets           FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_ticket_activities" ON ticket_activities FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_api_tokens"        ON api_tokens        FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_comments"          ON comments          FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_mentions"          ON mentions          FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_deliverables"      ON deliverables      FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_agent_personas"   ON agent_personas    FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE skills                ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_event_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE domain_event_log      ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_skills"                  ON skills                FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_agent_event_executions" ON agent_event_executions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_domain_event_log"       ON domain_event_log      FOR ALL USING (true) WITH CHECK (true);

-- ── App Config ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS app_config (
  id          TEXT PRIMARY KEY DEFAULT 'singleton',
  data        JSONB NOT NULL DEFAULT '{}',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_app_config" ON app_config FOR ALL USING (true) WITH CHECK (true);

-- ── User KV Store ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_kv (
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

ALTER TABLE user_kv ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_user_kv" ON user_kv FOR ALL USING (true) WITH CHECK (true);
