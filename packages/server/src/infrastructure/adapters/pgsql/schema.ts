export const PG_SCHEMA = `
-- Sessions
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  tmux_name TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  cwd TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  last_attached_at TIMESTAMPTZ,
  repository_org TEXT,
  repository_name TEXT,
  worktree_branch TEXT,
  git_remote TEXT,
  claude_prompt TEXT,
  display_name TEXT DEFAULT ''
);

-- Boards
CREATE TABLE IF NOT EXISTS boards (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  emoji TEXT NOT NULL DEFAULT '',
  next_display_id INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

-- Tickets
CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL REFERENCES boards(id),
  display_id INT NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT NOT NULL,
  priority TEXT DEFAULT 'none',
  type TEXT,
  position INT DEFAULT 0,
  tags JSONB DEFAULT '[]',
  links JSONB DEFAULT '[]',
  blocked BOOLEAN DEFAULT false,
  favorite BOOLEAN DEFAULT false,
  due_date TIMESTAMPTZ,
  assignee TEXT,
  agent_claimed_at TIMESTAMPTZ,
  github_metadata JSONB,
  first_doing_at TIMESTAMPTZ,
  status_changed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

-- Ticket activities
CREATE TABLE IF NOT EXISTS ticket_activities (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL,
  action TEXT NOT NULL,
  changes JSONB DEFAULT '{}',
  actor_type TEXT DEFAULT 'user',
  actor_name TEXT,
  source TEXT DEFAULT 'web',
  created_at TIMESTAMPTZ NOT NULL
);

-- API tokens
CREATE TABLE IF NOT EXISTS api_tokens (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  hashed_secret TEXT NOT NULL,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL
);

-- Comments
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL,
  author_type TEXT NOT NULL,
  author_name TEXT NOT NULL,
  body TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'public',
  private_recipients JSONB DEFAULT '[]',
  mentions JSONB DEFAULT '[]',
  parent_id TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

-- Mentions
CREATE TABLE IF NOT EXISTS mentions (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL,
  comment_id TEXT NOT NULL,
  target_agent TEXT NOT NULL,
  source_agent TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT 'agent',
  status TEXT NOT NULL DEFAULT 'pending',
  resolved_at TIMESTAMPTZ,
  resolved_comment_id TEXT,
  resolved_deliverable_id TEXT,
  created_at TIMESTAMPTZ NOT NULL
);

-- Deliverables
CREATE TABLE IF NOT EXISTS deliverables (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  version INT DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft',
  mention_id TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tickets_board_id ON tickets(board_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_ticket_activities_ticket_id ON ticket_activities(ticket_id);
CREATE INDEX IF NOT EXISTS idx_api_tokens_hashed_secret ON api_tokens(hashed_secret);
CREATE INDEX IF NOT EXISTS idx_comments_ticket_id ON comments(ticket_id);
CREATE INDEX IF NOT EXISTS idx_mentions_ticket_id ON mentions(ticket_id);
CREATE INDEX IF NOT EXISTS idx_mentions_status ON mentions(status);
CREATE INDEX IF NOT EXISTS idx_mentions_target_agent_status ON mentions(target_agent, status);
CREATE INDEX IF NOT EXISTS idx_deliverables_ticket_id ON deliverables(ticket_id);

-- Agent Personas
CREATE TABLE IF NOT EXISTS agent_personas (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  model TEXT NOT NULL,
  soul_md TEXT DEFAULT '',
  identity_md TEXT DEFAULT '',
  memory_md TEXT DEFAULT '',
  human_mention_name TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_personas_name ON agent_personas(name);

-- Skills
CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  command_name TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  markdown_content TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT true,
  persona_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_skills_command_name ON skills(command_name);
CREATE INDEX IF NOT EXISTS idx_skills_persona_id ON skills(persona_id);

-- Agent Event Executions
CREATE TABLE IF NOT EXISTS agent_event_executions (
  execution_id TEXT PRIMARY KEY,
  persona_id TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  mention_id TEXT NOT NULL,
  event_count INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running',
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  sdk_session_id TEXT,
  last_event_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agent_executions_ticket ON agent_event_executions(ticket_id);
CREATE INDEX IF NOT EXISTS idx_agent_executions_persona ON agent_event_executions(persona_id);

-- Domain Event Log
CREATE TABLE IF NOT EXISTS domain_event_log (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  instance_id TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_domain_event_log_occurred_at ON domain_event_log(occurred_at);
CREATE INDEX IF NOT EXISTS idx_domain_event_log_event_type ON domain_event_log(event_type);

-- App Config
CREATE TABLE IF NOT EXISTS app_config (
  id TEXT PRIMARY KEY DEFAULT 'singleton',
  data JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- KV Store
CREATE TABLE IF NOT EXISTS kv_store (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Migrations for existing databases
DO $$ BEGIN
  ALTER TABLE boards ADD COLUMN IF NOT EXISTS next_display_id INT NOT NULL DEFAULT 1;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE tickets ADD COLUMN IF NOT EXISTS display_id INT NOT NULL DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE agent_event_executions ADD COLUMN IF NOT EXISTS sdk_session_id TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE agent_event_executions ADD COLUMN IF NOT EXISTS last_event_at TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE tickets ADD COLUMN IF NOT EXISTS type TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE tickets ADD COLUMN IF NOT EXISTS first_doing_at TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
`;
