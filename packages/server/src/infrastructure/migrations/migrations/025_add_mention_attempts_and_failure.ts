import type { Migration } from '../types.js';

/**
 * Persist the execution recovery state on a mention (see
 * `docs/execution-recovery-policy.md`):
 *
 * - `attempt_count` — SDK executions started since the last success or human
 *   instruction. Drives the dead-letter predicate `attempt_count >= maxAttempts`,
 *   which is what stops a crash loop from being relaunchable forever.
 * - `failure_reason` / `failure_detail` — why the last run died. Persisted (not
 *   only broadcast on the WS event) so the crash card still shows the cause after
 *   a page reload — the ticket's acceptance criterion "failed WITH its reason".
 *
 * Existing rows read as a fresh budget (`0`) with no cause, so an in-flight
 * instance keeps working: a pre-migration mention is simply never dead-lettered.
 */
const migration: Migration = {
  name: '025_add_mention_attempts_and_failure',

  async up(ctx) {
    if (ctx.adapter === 'json') return;

    const columns = [
      ctx.dialect({
        sqlite: `ALTER TABLE mentions ADD COLUMN attempt_count INTEGER DEFAULT 0`,
        pgsql: `ALTER TABLE mentions ADD COLUMN attempt_count INTEGER DEFAULT 0`,
        supabase: `ALTER TABLE mentions ADD COLUMN attempt_count INTEGER DEFAULT 0`,
        json: null,
      }),
      ctx.dialect({
        sqlite: `ALTER TABLE mentions ADD COLUMN failure_reason TEXT`,
        pgsql: `ALTER TABLE mentions ADD COLUMN failure_reason TEXT`,
        supabase: `ALTER TABLE mentions ADD COLUMN failure_reason TEXT`,
        json: null,
      }),
      ctx.dialect({
        sqlite: `ALTER TABLE mentions ADD COLUMN failure_detail TEXT`,
        pgsql: `ALTER TABLE mentions ADD COLUMN failure_detail TEXT`,
        supabase: `ALTER TABLE mentions ADD COLUMN failure_detail TEXT`,
        json: null,
      }),
    ];

    for (const stmt of columns) {
      if (!stmt) continue;
      try {
        await ctx.exec(stmt);
      } catch {
        // Column may already exist (idempotent re-run).
      }
    }
  },

  async down(ctx) {
    if (ctx.adapter === 'json') return;
    if (ctx.adapter === 'sqlite') return; // older SQLite has no DROP COLUMN
    await ctx.exec(`ALTER TABLE mentions DROP COLUMN IF EXISTS attempt_count`);
    await ctx.exec(`ALTER TABLE mentions DROP COLUMN IF EXISTS failure_reason`);
    await ctx.exec(`ALTER TABLE mentions DROP COLUMN IF EXISTS failure_detail`);
  },
};

export default migration;
