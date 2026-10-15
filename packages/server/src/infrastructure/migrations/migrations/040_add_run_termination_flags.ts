import type { Migration } from '../types.js';

/**
 * Flags to track run termination state and prevent relaunching:
 *
 * - `auto_terminated_at_conclusion`: set to true when a run is auto-terminated
 *   as a side effect of concluding its thread. Distinguishes from manual termination.
 *
 * - `manually_terminated_by_user`: set to true when a user manually stops a run.
 *   The assistant respects this flag and never attempts to reschedule or restart
 *   such runs, eliminating conflicts between user intent and assistant auto-relaunching.
 *
 * Both flags default to false and persist across fetch/refresh cycles.
 */
const migration: Migration = {
  name: '040_add_run_termination_flags',

  async up(ctx) {
    const columns: [string, string][] = [
      ['auto_terminated_at_conclusion', 'BOOLEAN DEFAULT FALSE'],
      ['manually_terminated_by_user', 'BOOLEAN DEFAULT FALSE'],
    ];

    for (const [col, def] of columns) {
      if (ctx.adapter === 'sqlite') {
        try {
          await ctx.exec(
            `ALTER TABLE agent_event_executions ADD COLUMN ${col} ${def}`,
          );
        } catch {
          /* re-run after partial apply */
        }
      } else {
        await ctx.exec(
          `ALTER TABLE agent_event_executions ADD COLUMN IF NOT EXISTS ${col} ${def}`,
        );
      }
    }

    if (ctx.adapter === 'supabase') {
      await ctx.exec('NOTIFY pgrst, \'reload schema\'');
    }
  },

  async down(ctx) {
    if (ctx.adapter === 'sqlite') return; // older SQLite has no DROP COLUMN
    const columns = [
      'auto_terminated_at_conclusion',
      'manually_terminated_by_user',
    ];
    for (const col of columns) {
      await ctx.exec(
        `ALTER TABLE agent_event_executions DROP COLUMN IF EXISTS ${col}`,
      );
    }
  },
};

export default migration;
