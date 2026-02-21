-- ============================================================================
-- Agent Session Manager – Supabase Schema
-- Run this in the Supabase SQL Editor to create all required tables and indexes.
-- ============================================================================

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
  repository_org  TEXT,
  repository_name TEXT,
  created_at      TIMESTAMPTZ NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL
);

-- ── Tickets ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tickets (
  id                TEXT PRIMARY KEY,
  board_id          TEXT NOT NULL,
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

-- ── Row-Level Security ──────────────────────────────────────────────────────
-- Enable RLS on all tables and add permissive policies for the service role.

ALTER TABLE sessions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE boards            ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets           ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_tokens        ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE mentions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE deliverables      ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_sessions"          ON sessions          FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_boards"            ON boards            FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_tickets"           ON tickets           FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_ticket_activities" ON ticket_activities FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_api_tokens"        ON api_tokens        FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_comments"          ON comments          FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_mentions"          ON mentions          FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_deliverables"      ON deliverables      FOR ALL USING (true) WITH CHECK (true);
