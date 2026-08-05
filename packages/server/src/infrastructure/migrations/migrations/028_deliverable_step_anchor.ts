import type { Migration } from '../types.js';

/**
 * A deliverable is produced *by a step*, not by the run as a whole.
 *
 * Migration 025 gave `deliverables` a `workflow_run_id` so a routine run had
 * somewhere to hang its artifacts. That is too coarse for the run graph: with
 * only the run id, the UI cannot tell which node produced which deliverable and
 * has to fall back on title matching + recency. `step_run_id` is the real edge,
 * and it is what the React Flow view reads to render a deliverable on the node
 * that emitted it.
 *
 * `workflow_run_id` stays — rows written before this migration only have that,
 * and the run-level listing (routine detail screen) reads it directly rather
 * than joining through step_runs.
 */
const migration: Migration = {
  name: '028_deliverable_step_anchor',

  async up(ctx) {
    try {
      await ctx.exec('ALTER TABLE deliverables ADD COLUMN step_run_id TEXT');
    } catch {
      // Column already exists (idempotent re-run).
    }
    await ctx.exec('CREATE INDEX IF NOT EXISTS idx_deliverables_step_run ON deliverables(step_run_id)');
  },

  async down(ctx) {
    if (ctx.adapter !== 'sqlite') {
      await ctx.exec('DROP INDEX IF EXISTS idx_deliverables_step_run');
      await ctx.exec('ALTER TABLE deliverables DROP COLUMN IF EXISTS step_run_id');
    }
    // SQLite: a nullable column with no writer is inert, and dropping it would
    // require a full table rebuild — same rationale as migrations 025/027.
  },
};

export default migration;
