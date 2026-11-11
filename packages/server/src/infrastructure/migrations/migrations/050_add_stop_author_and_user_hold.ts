import type { Migration } from '../types.js';

/**
 * Who stopped a run, so that a stop a human asked for is never undone by the
 * assistant and never counted as a failure:
 *
 * - `agent_event_executions.stopped_by` (`user` | `assistant` | `system`) and
 *   `stop_reason`. The two booleans of migration 048 stay and are still read
 *   (`manually_terminated_by_user` ⇒ user, `auto_terminated_at_conclusion` ⇒ system).
 * - `workflow_runs.cancelled_by`: same author, for a cancelled run.
 * - `agent_threads.user_hold_at`: when a human stopped the thread's run. While
 *   set, the assistant may not relaunch the target; only a human lifts it.
 * - `agent_threads.last_stop`: JSON `{ by, at, reason, mentionId }` of the last
 *   wanted stop, shown to the assistant and in the UI until a new run starts.
 * - `agent_threads.concluded_by`: who concluded the thread.
 *
 * Additive and idempotent.
 */
const COLUMNS: [table: string, column: string][] = [
  ['agent_event_executions', 'stopped_by'],
  ['agent_event_executions', 'stop_reason'],
  ['workflow_runs', 'cancelled_by'],
  ['agent_threads', 'user_hold_at'],
  ['agent_threads', 'last_stop'],
  ['agent_threads', 'concluded_by'],
];

const migration: Migration = {
  name: '050_add_stop_author_and_user_hold',

  async up(ctx) {
    for (const [table, col] of COLUMNS) {
      if (ctx.adapter === 'sqlite') {
        try {
          await ctx.exec(`ALTER TABLE ${table} ADD COLUMN ${col} TEXT`);
        } catch {
          /* re-run after partial apply */
        }
      } else {
        // IF EXISTS: workflow tables are absent on adapters without workflow support.
        await ctx.exec(`ALTER TABLE IF EXISTS ${table} ADD COLUMN IF NOT EXISTS ${col} TEXT`);
      }
    }

    if (ctx.adapter === 'supabase') {
      await ctx.exec('NOTIFY pgrst, \'reload schema\'');
    }
  },

  async down(ctx) {
    if (ctx.adapter === 'sqlite') return; // older SQLite has no DROP COLUMN
    for (const [table, col] of COLUMNS) {
      await ctx.exec(`ALTER TABLE IF EXISTS ${table} DROP COLUMN IF EXISTS ${col}`);
    }
  },
};

export default migration;
