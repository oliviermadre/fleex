import type { Migration } from '../types.js';

/**
 * Make the ticket association OPTIONAL for agentic executions, so primitives
 * (workflows, and the underlying agent executions) can run without a ticket —
 * e.g. launched by a cron trigger rather than a @mention.
 *
 *  - workflow_runs.ticket_id        : NOT NULL  -> nullable
 *  - agent_event_executions.ticket_id : NOT NULL -> nullable
 *
 * PostgreSQL / Supabase support `ALTER COLUMN ... DROP NOT NULL` in place.
 * SQLite cannot drop a NOT NULL constraint, so we rebuild each table (create
 * new, copy rows, drop old, rename) following the procedure from the SQLite
 * docs. The migration runner does NOT wrap migrations in a transaction, so the
 * `PRAGMA foreign_keys` toggles take effect (they are no-ops inside a tx).
 *
 * NOTE: the SQLite rebuilds enumerate every current column (including those
 * added by migrations 006/007 on agent_event_executions). If new columns are
 * added to these tables in a LATER migration, that's fine — this migration ran
 * against the schema as it existed at sequence 020.
 */
const migration: Migration = {
  name: '020_make_execution_ticket_optional',

  async up(ctx) {
    if (ctx.adapter === 'json') return;

    if (ctx.adapter === 'pgsql' || ctx.adapter === 'supabase') {
      await ctx.exec('ALTER TABLE workflow_runs ALTER COLUMN ticket_id DROP NOT NULL');
      await ctx.exec('ALTER TABLE agent_event_executions ALTER COLUMN ticket_id DROP NOT NULL');
      return;
    }

    // ── SQLite: rebuild workflow_runs with a nullable ticket_id ──
    await ctx.exec(`
      PRAGMA foreign_keys=OFF;
      CREATE TABLE workflow_runs_new (
        id TEXT PRIMARY KEY,
        ticket_id TEXT REFERENCES tickets(id) ON DELETE CASCADE,
        template_id TEXT NOT NULL REFERENCES workflow_templates(id),
        template_snapshot TEXT NOT NULL,
        status TEXT NOT NULL,
        current_step_id TEXT,
        triggered_by TEXT NOT NULL,
        triggered_from TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO workflow_runs_new
        (id, ticket_id, template_id, template_snapshot, status, current_step_id,
         triggered_by, triggered_from, started_at, completed_at, created_at, updated_at)
      SELECT
        id, ticket_id, template_id, template_snapshot, status, current_step_id,
        triggered_by, triggered_from, started_at, completed_at, created_at, updated_at
      FROM workflow_runs;
      DROP TABLE workflow_runs;
      ALTER TABLE workflow_runs_new RENAME TO workflow_runs;
      CREATE INDEX IF NOT EXISTS idx_workflow_runs_ticket_status ON workflow_runs(ticket_id, status);
      PRAGMA foreign_keys=ON;
    `);

    // ── SQLite: rebuild agent_event_executions with a nullable ticket_id ──
    // Columns reflect 001 (base) + 006 (metrics) + 007 (model/token breakdown).
    await ctx.exec(`
      PRAGMA foreign_keys=OFF;
      CREATE TABLE agent_event_executions_new (
        execution_id TEXT PRIMARY KEY,
        persona_id TEXT NOT NULL,
        ticket_id TEXT,
        mention_id TEXT NOT NULL,
        event_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'running',
        started_at TEXT NOT NULL,
        completed_at TEXT,
        sdk_session_id TEXT,
        last_event_at TEXT,
        effective_mode TEXT,
        duration_ms INTEGER,
        cost_usd REAL,
        input_tokens INTEGER,
        output_tokens INTEGER,
        model TEXT,
        cache_read_tokens INTEGER,
        cache_creation_tokens INTEGER
      );
      INSERT INTO agent_event_executions_new
        (execution_id, persona_id, ticket_id, mention_id, event_count, status,
         started_at, completed_at, sdk_session_id, last_event_at,
         effective_mode, duration_ms, cost_usd, input_tokens, output_tokens,
         model, cache_read_tokens, cache_creation_tokens)
      SELECT
        execution_id, persona_id, ticket_id, mention_id, event_count, status,
        started_at, completed_at, sdk_session_id, last_event_at,
        effective_mode, duration_ms, cost_usd, input_tokens, output_tokens,
        model, cache_read_tokens, cache_creation_tokens
      FROM agent_event_executions;
      DROP TABLE agent_event_executions;
      ALTER TABLE agent_event_executions_new RENAME TO agent_event_executions;
      CREATE INDEX IF NOT EXISTS idx_agent_executions_ticket ON agent_event_executions(ticket_id);
      CREATE INDEX IF NOT EXISTS idx_agent_executions_persona ON agent_event_executions(persona_id);
      PRAGMA foreign_keys=ON;
    `);
  },

  async down(ctx) {
    // Best-effort: re-impose NOT NULL on Postgres/Supabase. (Rows with NULL
    // ticket_id must be removed first or this will fail — acceptable for a
    // rollback.) SQLite down is a no-op: a nullable column is a strict superset
    // and reverting would require another full rebuild with no real benefit.
    if (ctx.adapter === 'pgsql' || ctx.adapter === 'supabase') {
      await ctx.exec('ALTER TABLE workflow_runs ALTER COLUMN ticket_id SET NOT NULL');
      await ctx.exec('ALTER TABLE agent_event_executions ALTER COLUMN ticket_id SET NOT NULL');
    }
  },
};

export default migration;
