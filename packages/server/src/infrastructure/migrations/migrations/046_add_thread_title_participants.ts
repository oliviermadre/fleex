import type { Migration } from '../types.js';

/**
 * Thread label enrichment for better UX:
 *
 * - `generated_title`: Haiku-generated title for the thread, computed serverside
 *   at the first message of the thread (sync). The title is immutable after generation
 *   and persists in the database.
 *
 * - `participants`: JSON array of participant objects (userId, displayName, avatar)
 *   representing users who sent messages with bubbles in the thread. Aggregated
 *   serverside when the thread is queried or updated. Max 5 displayed in UI, with
 *   an overflow badge (+N) if more participants exist.
 *
 * These fields enable the thread label to display as: 🧵 [Title] [Avatars...]
 * Additive and idempotent.
 */
const migration: Migration = {
  name: '046_add_thread_title_participants',

  async up(ctx) {
    const columns: [string, string][] = [
      ['generated_title', 'TEXT'],
      ['participants', 'TEXT DEFAULT \'[]\''], // JSON array serialized as TEXT
    ];

    for (const [col, def] of columns) {
      if (ctx.adapter === 'sqlite') {
        try {
          await ctx.exec(`ALTER TABLE agent_threads ADD COLUMN ${col} ${def}`);
        } catch {
          /* re-run after partial apply */
        }
      } else {
        await ctx.exec(
          `ALTER TABLE agent_threads ADD COLUMN IF NOT EXISTS ${col} ${def}`,
        );
      }
    }

    if (ctx.adapter === 'supabase') {
      await ctx.exec('NOTIFY pgrst, \'reload schema\'');
    }
  },

  async down(ctx) {
    if (ctx.adapter === 'sqlite') return; // older SQLite has no DROP COLUMN
    const columns = ['generated_title', 'participants'];
    for (const col of columns) {
      await ctx.exec(`ALTER TABLE agent_threads DROP COLUMN IF EXISTS ${col}`);
    }
  },
};

export default migration;
