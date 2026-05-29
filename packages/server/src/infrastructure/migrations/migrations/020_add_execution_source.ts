import type { Migration } from '../types.js';

/**
 * Track the *source* of an execution on `agent_event_executions`.
 *
 * Distinguishes fleex-orchestrated agentic runs ('agent' | 'skill' | 'panel' |
 * 'workflow') from manually-run Claude Code sessions ('manual') that are recorded
 * post-hoc on `SessionEnd` so their token usage can be tallied per ticket and
 * separated from agentic consumption in statistics.
 *
 * Existing rows default to 'agent' (they predate manual-session recording).
 */
const migration: Migration = {
  name: '020_add_execution_source',

  async up(ctx) {
    if (ctx.adapter === 'json') return; // JSON adapter persists the entity blob — no schema change

    const sql = ctx.dialect({
      sqlite: `ALTER TABLE agent_event_executions ADD COLUMN source TEXT NOT NULL DEFAULT 'agent'`,
      pgsql: `ALTER TABLE agent_event_executions ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'agent'`,
      supabase: `ALTER TABLE agent_event_executions ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'agent'`,
      json: null,
    });
    if (sql) await ctx.exec(sql);

    // Manual-vs-agentic splits scan by source in the statistics use case.
    await ctx.exec(
      `CREATE INDEX IF NOT EXISTS idx_agent_executions_source ON agent_event_executions(source)`,
    );
  },

  async down(ctx) {
    if (ctx.adapter === 'json') return;

    await ctx.exec(`DROP INDEX IF EXISTS idx_agent_executions_source`);

    const sql = ctx.dialect({
      sqlite: `ALTER TABLE agent_event_executions DROP COLUMN source`,
      pgsql: `ALTER TABLE agent_event_executions DROP COLUMN IF EXISTS source`,
      supabase: `ALTER TABLE agent_event_executions DROP COLUMN IF EXISTS source`,
      json: null,
    });
    if (sql) {
      try {
        await ctx.exec(sql);
      } catch {
        // SQLite < 3.35 doesn't support DROP COLUMN — harmless legacy field remains.
      }
    }
  },
};

export default migration;
