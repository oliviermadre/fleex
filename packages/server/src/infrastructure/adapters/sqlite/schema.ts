export const SQLITE_SCHEMA: string[] = [
  // ── Sessions ──
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    tmux_name TEXT NOT NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL,
    cwd TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_attached_at TEXT,
    repository_org TEXT,
    repository_name TEXT,
    worktree_branch TEXT,
    git_remote TEXT,
    claude_prompt TEXT,
    display_name TEXT
  )`,

  // ── Boards ──
  `CREATE TABLE IF NOT EXISTS boards (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    emoji TEXT NOT NULL,
    next_display_id INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  // ── Tickets ──
  `CREATE TABLE IF NOT EXISTS tickets (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL,
    display_id INTEGER NOT NULL DEFAULT 0,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL,
    priority TEXT NOT NULL,
    type TEXT,
    position INTEGER NOT NULL,
    tags TEXT NOT NULL,
    links TEXT NOT NULL,
    blocked INTEGER NOT NULL DEFAULT 0,
    favorite INTEGER NOT NULL DEFAULT 0,
    due_date TEXT,
    assignee TEXT,
    agent_claimed_at TEXT,
    github_metadata TEXT,
    first_doing_at TEXT,
    status_changed_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  // ── Ticket Activities ──
  `CREATE TABLE IF NOT EXISTS ticket_activities (
    id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL,
    action TEXT NOT NULL,
    changes TEXT NOT NULL,
    actor_type TEXT NOT NULL,
    actor_name TEXT,
    source TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,

  // ── API Tokens ──
  `CREATE TABLE IF NOT EXISTS api_tokens (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    prefix TEXT NOT NULL,
    hashed_secret TEXT NOT NULL,
    last_used_at TEXT,
    created_at TEXT NOT NULL
  )`,

  // ── Comments ──
  `CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL,
    author_type TEXT NOT NULL,
    author_name TEXT NOT NULL,
    body TEXT NOT NULL,
    visibility TEXT NOT NULL,
    private_recipients TEXT NOT NULL,
    mentions TEXT NOT NULL,
    parent_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  // ── Mentions ──
  `CREATE TABLE IF NOT EXISTS mentions (
    id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL,
    comment_id TEXT NOT NULL,
    target_agent TEXT NOT NULL,
    source_agent TEXT NOT NULL,
    target_type TEXT NOT NULL DEFAULT 'agent',
    status TEXT NOT NULL,
    resolved_at TEXT,
    resolved_comment_id TEXT,
    resolved_deliverable_id TEXT,
    created_at TEXT NOT NULL
  )`,

  // ── Deliverables ──
  `CREATE TABLE IF NOT EXISTS deliverables (
    id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL,
    agent_name TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'draft',
    mention_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  // ── Indexes ──

  // Tickets
  `CREATE INDEX IF NOT EXISTS idx_tickets_board_id ON tickets(board_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status)`,

  // Ticket Activities
  `CREATE INDEX IF NOT EXISTS idx_ticket_activities_ticket_id ON ticket_activities(ticket_id)`,

  // API Tokens
  `CREATE INDEX IF NOT EXISTS idx_api_tokens_hashed_secret ON api_tokens(hashed_secret)`,

  // Comments
  `CREATE INDEX IF NOT EXISTS idx_comments_ticket_id ON comments(ticket_id)`,

  // Mentions
  `CREATE INDEX IF NOT EXISTS idx_mentions_ticket_id ON mentions(ticket_id)`,
  `CREATE INDEX IF NOT EXISTS idx_mentions_status ON mentions(status)`,
  `CREATE INDEX IF NOT EXISTS idx_mentions_target_agent_status ON mentions(target_agent, status)`,
  `CREATE INDEX IF NOT EXISTS idx_mentions_comment_id ON mentions(comment_id)`,

  // Deliverables
  `CREATE INDEX IF NOT EXISTS idx_deliverables_ticket_id ON deliverables(ticket_id)`,

  // ── Agent Personas ──
  `CREATE TABLE IF NOT EXISTS agent_personas (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    model TEXT NOT NULL,
    soul_md TEXT DEFAULT '',
    identity_md TEXT DEFAULT '',
    memory_md TEXT DEFAULT '',
    human_mention_name TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  `CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_personas_name ON agent_personas(name)`,

  // ── Skills ──
  `CREATE TABLE IF NOT EXISTS skills (
    id TEXT PRIMARY KEY,
    command_name TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    display_name TEXT NOT NULL,
    markdown_content TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    persona_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_skills_command_name ON skills(command_name)`,
  `CREATE INDEX IF NOT EXISTS idx_skills_persona_id ON skills(persona_id)`,

  // ── Panels ──
  `CREATE TABLE IF NOT EXISTS panels (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    members TEXT NOT NULL DEFAULT '[]',
    orchestrator_prompt TEXT NOT NULL DEFAULT '',
    orchestrator_model TEXT NOT NULL DEFAULT 'claude-sonnet-4-5-20250929',
    default_member_model TEXT NOT NULL DEFAULT 'claude-sonnet-4-5-20250929',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_panels_name ON panels(name)`,

  // ── Agent Event Executions ──
  `CREATE TABLE IF NOT EXISTS agent_event_executions (
    execution_id TEXT PRIMARY KEY,
    persona_id TEXT NOT NULL,
    ticket_id TEXT NOT NULL,
    mention_id TEXT NOT NULL,
    event_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'running',
    started_at TEXT NOT NULL,
    completed_at TEXT,
    sdk_session_id TEXT,
    last_event_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_agent_executions_ticket ON agent_event_executions(ticket_id)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_executions_persona ON agent_event_executions(persona_id)`,

  // ── Domain Event Log ──
  `CREATE TABLE IF NOT EXISTS domain_event_log (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    instance_id TEXT NOT NULL,
    occurred_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_domain_event_log_occurred_at ON domain_event_log(occurred_at)`,
  `CREATE INDEX IF NOT EXISTS idx_domain_event_log_event_type ON domain_event_log(event_type)`,

  // ── App Config ──
  `CREATE TABLE IF NOT EXISTS app_config (
    id TEXT PRIMARY KEY DEFAULT 'singleton',
    data TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL
  )`,

  // ── KV Store ──
  `CREATE TABLE IF NOT EXISTS kv_store (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  // ── Files (uploaded attachments) ──
  `CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    created_at TEXT NOT NULL
  )`,
];
