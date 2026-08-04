import type { Migration } from '../types.js';

/**
 * `workflow_runs.parent_run_id` — which run spawned this one.
 *
 * Needed by `workflow.trigger`: a workflow that triggers a workflow that
 * triggers a workflow has no natural stopping point, and a template that
 * triggers *itself* would fan out until the database gives up. The column lets
 * `CreateWorkflowRun` walk the chain of ancestors and refuse past a fixed depth.
 *
 * No new table, so no RLS block (cf. CLAUDE.md) — the policies on
 * `workflow_runs` already cover the new column.
 */
const migration: Migration = {
  name: '026_add_workflow_run_parent',

  async up(ctx) {
    // SQLite has no `ADD COLUMN IF NOT EXISTS`; PostgreSQL does, and using it
    // matters there because a failed statement aborts the surrounding
    // transaction, which the catch below could not undo.
    const ifNotExists = ctx.dialect({
      sqlite: '',
      pgsql: 'IF NOT EXISTS ',
      supabase: 'IF NOT EXISTS ',
    });
    try {
      await ctx.exec(`ALTER TABLE workflow_runs ADD COLUMN ${ifNotExists}parent_run_id TEXT`);
    } catch {
      // SQLite, column already there (idempotent re-run).
    }

    // Walking the chain is a lookup per ancestor on every triggered run; without
    // the index that is a full scan of every run ever executed.
    await ctx.exec(
      'CREATE INDEX IF NOT EXISTS idx_workflow_runs_parent ON workflow_runs(parent_run_id)',
    );
  },

  async down(ctx) {
    await ctx.exec('DROP INDEX IF EXISTS idx_workflow_runs_parent');
    if (ctx.adapter !== 'sqlite') {
      await ctx.exec('ALTER TABLE workflow_runs DROP COLUMN IF EXISTS parent_run_id');
    }
    // SQLite: dropping the column would require the full table rebuild this
    // migration deliberately avoids, and a nullable column with no writer is
    // inert. Same call as 025.
  },
};

export default migration;
