import type { Migration } from '../types.js';

/**
 * Baseline migration: creates all tables and indexes for the current schema.
 *
 * For existing installations this is entirely idempotent — every statement uses
 * IF NOT EXISTS, so nothing is dropped, altered, or duplicated. The migration
 * is simply recorded in _migrations so future migrations run from here.
 */
const migration: Migration = {
  name: '001_initial_schema',

  async up(ctx) {
    // ── Sessions ──
    const sessionsSql = ctx.dialect({
      sqlite: `CREATE TABLE IF NOT EXISTS sessions (
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
      pgsql: `CREATE TABLE IF NOT EXISTS sessions (
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
      )`,
      supabase: `CREATE TABLE IF NOT EXISTS sessions (
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
        display_name TEXT
      )`,
    });
    if (sessionsSql) await ctx.exec(sessionsSql);

    // ── Boards ──
    const boardsSql = ctx.dialect({
      sqlite: `CREATE TABLE IF NOT EXISTS boards (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        emoji TEXT NOT NULL,
        repository_org TEXT,
        repository_name TEXT,
        next_display_id INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      pgsql: `CREATE TABLE IF NOT EXISTS boards (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        emoji TEXT NOT NULL DEFAULT '',
        repository_org TEXT,
        repository_name TEXT,
        next_display_id INT NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      )`,
      supabase: `CREATE TABLE IF NOT EXISTS boards (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        emoji TEXT NOT NULL,
        repository_org TEXT,
        repository_name TEXT,
        next_display_id INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      )`,
    });
    if (boardsSql) await ctx.exec(boardsSql);

    // ── Tickets ──
    const ticketsSql = ctx.dialect({
      sqlite: `CREATE TABLE IF NOT EXISTS tickets (
        id TEXT PRIMARY KEY,
        board_id TEXT NOT NULL,
        display_id INTEGER NOT NULL DEFAULT 0,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL,
        priority TEXT NOT NULL,
        position INTEGER NOT NULL,
        tags TEXT NOT NULL,
        links TEXT NOT NULL,
        blocked INTEGER NOT NULL DEFAULT 0,
        favorite INTEGER NOT NULL DEFAULT 0,
        due_date TEXT,
        assignee TEXT,
        agent_claimed_at TEXT,
        github_metadata TEXT,
        status_changed_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      pgsql: `CREATE TABLE IF NOT EXISTS tickets (
        id TEXT PRIMARY KEY,
        board_id TEXT NOT NULL REFERENCES boards(id),
        display_id INT NOT NULL DEFAULT 0,
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
      )`,
      supabase: `CREATE TABLE IF NOT EXISTS tickets (
        id TEXT PRIMARY KEY,
        board_id TEXT NOT NULL,
        display_id INTEGER NOT NULL DEFAULT 0,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL,
        priority TEXT NOT NULL,
        position INTEGER NOT NULL,
        tags JSONB NOT NULL DEFAULT '[]',
        links JSONB NOT NULL DEFAULT '[]',
        blocked BOOLEAN NOT NULL DEFAULT FALSE,
        favorite BOOLEAN NOT NULL DEFAULT FALSE,
        due_date TIMESTAMPTZ,
        assignee TEXT,
        agent_claimed_at TIMESTAMPTZ,
        github_metadata JSONB,
        status_changed_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      )`,
    });
    if (ticketsSql) await ctx.exec(ticketsSql);

    // ── Ticket Activities ──
    const ticketActivitiesSql = ctx.dialect({
      sqlite: `CREATE TABLE IF NOT EXISTS ticket_activities (
        id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL,
        action TEXT NOT NULL,
        changes TEXT NOT NULL,
        actor_type TEXT NOT NULL,
        actor_name TEXT,
        source TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      pgsql: `CREATE TABLE IF NOT EXISTS ticket_activities (
        id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL,
        action TEXT NOT NULL,
        changes JSONB DEFAULT '{}',
        actor_type TEXT DEFAULT 'user',
        actor_name TEXT,
        source TEXT DEFAULT 'web',
        created_at TIMESTAMPTZ NOT NULL
      )`,
      supabase: `CREATE TABLE IF NOT EXISTS ticket_activities (
        id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL,
        action TEXT NOT NULL,
        changes JSONB NOT NULL DEFAULT '{}',
        actor_type TEXT NOT NULL,
        actor_name TEXT,
        source TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
      )`,
    });
    if (ticketActivitiesSql) await ctx.exec(ticketActivitiesSql);

    // ── API Tokens ──
    const apiTokensSql = ctx.dialect({
      sqlite: `CREATE TABLE IF NOT EXISTS api_tokens (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        prefix TEXT NOT NULL,
        hashed_secret TEXT NOT NULL,
        last_used_at TEXT,
        created_at TEXT NOT NULL
      )`,
      pgsql: `CREATE TABLE IF NOT EXISTS api_tokens (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        prefix TEXT NOT NULL,
        hashed_secret TEXT NOT NULL,
        last_used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL
      )`,
      supabase: `CREATE TABLE IF NOT EXISTS api_tokens (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        prefix TEXT NOT NULL,
        hashed_secret TEXT NOT NULL,
        last_used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL
      )`,
    });
    if (apiTokensSql) await ctx.exec(apiTokensSql);

    // ── Comments ──
    const commentsSql = ctx.dialect({
      sqlite: `CREATE TABLE IF NOT EXISTS comments (
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
      pgsql: `CREATE TABLE IF NOT EXISTS comments (
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
      )`,
      supabase: `CREATE TABLE IF NOT EXISTS comments (
        id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL,
        author_type TEXT NOT NULL,
        author_name TEXT NOT NULL,
        body TEXT NOT NULL,
        visibility TEXT NOT NULL,
        private_recipients JSONB NOT NULL DEFAULT '[]',
        mentions JSONB NOT NULL DEFAULT '[]',
        parent_id TEXT,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      )`,
    });
    if (commentsSql) await ctx.exec(commentsSql);

    // ── Mentions ──
    const mentionsSql = ctx.dialect({
      sqlite: `CREATE TABLE IF NOT EXISTS mentions (
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
      pgsql: `CREATE TABLE IF NOT EXISTS mentions (
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
      )`,
      supabase: `CREATE TABLE IF NOT EXISTS mentions (
        id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL,
        comment_id TEXT NOT NULL,
        target_agent TEXT NOT NULL,
        source_agent TEXT NOT NULL,
        target_type TEXT NOT NULL DEFAULT 'agent',
        status TEXT NOT NULL,
        resolved_at TIMESTAMPTZ,
        resolved_comment_id TEXT,
        resolved_deliverable_id TEXT,
        created_at TIMESTAMPTZ NOT NULL
      )`,
    });
    if (mentionsSql) await ctx.exec(mentionsSql);

    // ── Deliverables ──
    const deliverablesSql = ctx.dialect({
      sqlite: `CREATE TABLE IF NOT EXISTS deliverables (
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
      pgsql: `CREATE TABLE IF NOT EXISTS deliverables (
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
      )`,
      supabase: `CREATE TABLE IF NOT EXISTS deliverables (
        id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL,
        agent_name TEXT NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'draft',
        mention_id TEXT,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      )`,
    });
    if (deliverablesSql) await ctx.exec(deliverablesSql);

    // ── Indexes ──
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_tickets_board_id ON tickets(board_id)',
      'CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status)',
      'CREATE INDEX IF NOT EXISTS idx_ticket_activities_ticket_id ON ticket_activities(ticket_id)',
      'CREATE INDEX IF NOT EXISTS idx_api_tokens_hashed_secret ON api_tokens(hashed_secret)',
      'CREATE INDEX IF NOT EXISTS idx_comments_ticket_id ON comments(ticket_id)',
      'CREATE INDEX IF NOT EXISTS idx_mentions_ticket_id ON mentions(ticket_id)',
      'CREATE INDEX IF NOT EXISTS idx_mentions_status ON mentions(status)',
      'CREATE INDEX IF NOT EXISTS idx_mentions_target_agent_status ON mentions(target_agent, status)',
      'CREATE INDEX IF NOT EXISTS idx_mentions_comment_id ON mentions(comment_id)',
      'CREATE INDEX IF NOT EXISTS idx_deliverables_ticket_id ON deliverables(ticket_id)',
    ];

    for (const sql of indexes) {
      await ctx.exec(sql);
    }

    // ── Agent Personas ──
    const personasSql = ctx.dialect({
      sqlite: `CREATE TABLE IF NOT EXISTS agent_personas (
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
      pgsql: `CREATE TABLE IF NOT EXISTS agent_personas (
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
      )`,
      supabase: `CREATE TABLE IF NOT EXISTS agent_personas (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        model TEXT NOT NULL,
        soul_md TEXT NOT NULL DEFAULT '',
        identity_md TEXT NOT NULL DEFAULT '',
        memory_md TEXT NOT NULL DEFAULT '',
        human_mention_name TEXT,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      )`,
    });
    if (personasSql) await ctx.exec(personasSql);

    await ctx.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_personas_name ON agent_personas(name)');

    // ── Agent Event Executions ──
    const execSql = ctx.dialect({
      sqlite: `CREATE TABLE IF NOT EXISTS agent_event_executions (
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
      pgsql: `CREATE TABLE IF NOT EXISTS agent_event_executions (
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
      )`,
      supabase: `CREATE TABLE IF NOT EXISTS agent_event_executions (
        execution_id TEXT PRIMARY KEY,
        persona_id TEXT NOT NULL,
        ticket_id TEXT NOT NULL,
        mention_id TEXT NOT NULL,
        event_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'running',
        started_at TIMESTAMPTZ NOT NULL,
        completed_at TIMESTAMPTZ,
        sdk_session_id TEXT,
        last_event_at TIMESTAMPTZ
      )`,
    });
    if (execSql) await ctx.exec(execSql);

    await ctx.exec('CREATE INDEX IF NOT EXISTS idx_agent_executions_ticket ON agent_event_executions(ticket_id)');
    await ctx.exec('CREATE INDEX IF NOT EXISTS idx_agent_executions_persona ON agent_event_executions(persona_id)');

    // ── Domain Event Log ──
    const eventLogSql = ctx.dialect({
      sqlite: `CREATE TABLE IF NOT EXISTS domain_event_log (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        instance_id TEXT NOT NULL,
        occurred_at TEXT NOT NULL
      )`,
      pgsql: `CREATE TABLE IF NOT EXISTS domain_event_log (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        payload JSONB NOT NULL,
        instance_id TEXT NOT NULL,
        occurred_at TIMESTAMPTZ NOT NULL
      )`,
      supabase: `CREATE TABLE IF NOT EXISTS domain_event_log (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        payload JSONB NOT NULL,
        instance_id TEXT NOT NULL,
        occurred_at TIMESTAMPTZ NOT NULL
      )`,
    });
    if (eventLogSql) await ctx.exec(eventLogSql);

    await ctx.exec('CREATE INDEX IF NOT EXISTS idx_domain_event_log_occurred_at ON domain_event_log(occurred_at)');
    await ctx.exec('CREATE INDEX IF NOT EXISTS idx_domain_event_log_event_type ON domain_event_log(event_type)');

    // ── App Config ──
    const appConfigSql = ctx.dialect({
      sqlite: `CREATE TABLE IF NOT EXISTS app_config (
        id TEXT PRIMARY KEY DEFAULT 'singleton',
        data TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL
      )`,
      pgsql: `CREATE TABLE IF NOT EXISTS app_config (
        id TEXT PRIMARY KEY DEFAULT 'singleton',
        data JSONB NOT NULL DEFAULT '{}',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      supabase: `CREATE TABLE IF NOT EXISTS app_config (
        id TEXT PRIMARY KEY DEFAULT 'singleton',
        data JSONB NOT NULL DEFAULT '{}',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
    });
    if (appConfigSql) await ctx.exec(appConfigSql);

    // ── KV Store ──
    const kvSql = ctx.dialect({
      sqlite: `CREATE TABLE IF NOT EXISTS kv_store (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      pgsql: `CREATE TABLE IF NOT EXISTS kv_store (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      supabase: null, // Supabase uses user_kv, managed via SQL Editor
    });
    if (kvSql) await ctx.exec(kvSql);
  },

  async down(ctx) {
    // Reverse order: drop tables that depend on others first
    const tables = [
      'kv_store',
      'app_config',
      'domain_event_log',
      'agent_event_executions',
      'agent_personas',
      'deliverables',
      'mentions',
      'comments',
      'api_tokens',
      'ticket_activities',
      'tickets',
      'boards',
      'sessions',
    ];

    for (const table of tables) {
      await ctx.exec(`DROP TABLE IF EXISTS ${table}`);
    }
  },
};

export default migration;
