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
  repository_org TEXT,
  repository_name TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

-- Tickets
CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL REFERENCES boards(id),
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT NOT NULL,
  priority TEXT DEFAULT 'none',
  position INT DEFAULT 0,
  tags JSONB DEFAULT '[]',
  links JSONB DEFAULT '[]',
  blocked BOOLEAN DEFAULT false,
  favorite BOOLEAN DEFAULT false,
  due_date TIMESTAMPTZ,
  assignee TEXT,
  agent_claimed_at TIMESTAMPTZ,
  github_metadata JSONB,
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
`;
