import type { Migration } from '../types.js';

/**
 * Link an agentic execution to the artifacts it produced: the comment and/or the
 * deliverable. Until now the execution row (`agent_event_executions`) only carried
 * `mention_id`, which is a polymorphic/overloaded correlation key (real UUID for
 * personas, synthetic `skill:` / `workflow:` / `panel:` / `cli:` prefixes otherwise)
 * — so workflow-step artifacts had no reliable link back to their execution. That
 * forced the UI to guess a comment↔deliverable pairing by pattern-matching on
 * `agentName`.
 *
 * These two nullable FK-ish columns make the link explicit (a run produces 0/1
 * comment and/or 0/1 deliverable), which lets the Comments tab derive a deliverable
 * chip — and surface the Human Gate deliverable — without any `agentName` matching.
 *
 * Non-destructive: two nullable TEXT columns on an existing table (no new RLS
 * needed). Existing rows stay NULL (graceful degradation: no chip on history).
 * The JSON adapter stores these on its index entry and needs no schema change.
 */
const migration: Migration = {
  name: '024_add_execution_output_refs',

  async up(ctx) {
    if (ctx.adapter === 'json') return;

    const cols = [
      {
        sqlite: `ALTER TABLE agent_event_executions ADD COLUMN comment_id TEXT`,
        pgsql: `ALTER TABLE agent_event_executions ADD COLUMN comment_id TEXT`,
        supabase: `ALTER TABLE agent_event_executions ADD COLUMN comment_id TEXT`,
      },
      {
        sqlite: `ALTER TABLE agent_event_executions ADD COLUMN deliverable_id TEXT`,
        pgsql: `ALTER TABLE agent_event_executions ADD COLUMN deliverable_id TEXT`,
        supabase: `ALTER TABLE agent_event_executions ADD COLUMN deliverable_id TEXT`,
      },
    ];

    for (const col of cols) {
      const stmt = ctx.dialect({ ...col, json: null });
      if (!stmt) continue;
      try {
        await ctx.exec(stmt);
      } catch {
        // Column may already exist (idempotent re-run).
      }
    }

    const indexes = [
      `CREATE INDEX IF NOT EXISTS idx_agent_exec_comment ON agent_event_executions(comment_id)`,
      `CREATE INDEX IF NOT EXISTS idx_agent_exec_deliverable ON agent_event_executions(deliverable_id)`,
    ];
    for (const stmt of indexes) {
      try {
        await ctx.exec(stmt);
      } catch {
        // Index may already exist (idempotent re-run).
      }
    }
  },

  async down(ctx) {
    if (ctx.adapter === 'json') return;
    // SQLite doesn't support DROP COLUMN in older versions; skip for safety.
    if (ctx.adapter === 'sqlite') return;
    for (const name of ['comment_id', 'deliverable_id']) {
      await ctx.exec(`ALTER TABLE agent_event_executions DROP COLUMN IF EXISTS ${name}`);
    }
  },
};

export default migration;
