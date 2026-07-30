import type { Migration } from '../types.js';

/**
 * Record which Fleex instance owns an agentic execution.
 *
 * With shared storage (Supabase/pgsql) several instances write to the same
 * `agent_event_executions` table, but nothing said *where* a run was happening.
 * Two consequences:
 *
 *  1. `markInterruptedExecutions()` swept `WHERE status = 'running'` with no
 *     instance predicate, so booting instance B marked instance A's live runs as
 *     `interrupted` and reset their mentions to `pending` — killing (and
 *     potentially re-triggering) a run on another machine.
 *  2. The UI could not tell a local run from a sibling's, so "Terminate" (which
 *     only ever works in the owning process) failed with an opaque 404.
 *
 * `instance_id` is the stable routing key (`FLEEX_INSTANCE_ID`, else
 * `hostname:port`); `instance_label` is the human-facing hostname shown in the
 * Execution Log.
 *
 * One-shot cleanup: every pre-existing `running` row has a NULL `instance_id`
 * and can never be claimed by an instance-scoped sweep, so it would stay
 * `running` forever. Flip those to `interrupted` here — once — which lets the
 * new sweep predicate be strictly `instance_id = ?`. A run that happens to be
 * live at migration time is collateral (single occurrence, and its mention is
 * reset to pending by the normal recovery path).
 *
 * Non-destructive otherwise: two nullable TEXT columns on an existing table, so
 * no new RLS policy is needed. The JSON adapter keeps these on its index entry
 * and needs no schema change.
 */
const migration: Migration = {
  name: '025_add_execution_instance',

  async up(ctx) {
    if (ctx.adapter === 'json') return;

    const cols = [
      `ALTER TABLE agent_event_executions ADD COLUMN instance_id TEXT`,
      `ALTER TABLE agent_event_executions ADD COLUMN instance_label TEXT`,
    ];
    for (const sql of cols) {
      const stmt = ctx.dialect({ sqlite: sql, pgsql: sql, supabase: sql, json: null });
      if (!stmt) continue;
      try {
        await ctx.exec(stmt);
      } catch {
        // Column may already exist (idempotent re-run).
      }
    }

    try {
      await ctx.exec(
        `CREATE INDEX IF NOT EXISTS idx_agent_executions_instance ON agent_event_executions(instance_id, status)`,
      );
    } catch {
      // Index may already exist (idempotent re-run).
    }

    // One-shot: retire ownerless running rows (see the note above).
    const now = new Date().toISOString();
    try {
      await ctx.exec(
        `UPDATE agent_event_executions SET status = 'interrupted', completed_at = '${now}' ` +
          `WHERE status = 'running' AND instance_id IS NULL`,
      );
    } catch {
      // Best-effort: a failure here only leaves legacy rows stuck as `running`.
    }
  },

  async down(ctx) {
    if (ctx.adapter === 'json') return;
    // SQLite doesn't support DROP COLUMN in older versions; skip for safety.
    if (ctx.adapter === 'sqlite') return;
    for (const name of ['instance_id', 'instance_label']) {
      await ctx.exec(`ALTER TABLE agent_event_executions DROP COLUMN IF EXISTS ${name}`);
    }
  },
};

export default migration;
