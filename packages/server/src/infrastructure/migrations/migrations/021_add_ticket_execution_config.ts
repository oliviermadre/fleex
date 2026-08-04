import type { Migration } from '../types.js';

/**
 * Conversation-scoped execution config on tickets: the mode (talk/plan/edit) is
 * now an attribute of the conversation rather than stamped per-mention, plus an
 * optional model/effort/fast override resolved when a mention is acknowledged.
 *
 * Non-destructive: four nullable columns with sane defaults. JSON adapter stores
 * these on the serialized ticket and needs no schema change.
 */
const migration: Migration = {
  name: '021_add_ticket_execution_config',

  async up(ctx) {

    const cols: { name: string; sql: { sqlite: string; pgsql: string; supabase: string } }[] = [
      {
        name: 'conversation_mode',
        sql: {
          sqlite: `ALTER TABLE tickets ADD COLUMN conversation_mode TEXT NOT NULL DEFAULT 'plan'`,
          pgsql: `ALTER TABLE tickets ADD COLUMN conversation_mode TEXT NOT NULL DEFAULT 'plan'`,
          supabase: `ALTER TABLE tickets ADD COLUMN conversation_mode TEXT NOT NULL DEFAULT 'plan'`,
        },
      },
      {
        name: 'model_override',
        sql: {
          sqlite: `ALTER TABLE tickets ADD COLUMN model_override TEXT`,
          pgsql: `ALTER TABLE tickets ADD COLUMN model_override TEXT`,
          supabase: `ALTER TABLE tickets ADD COLUMN model_override TEXT`,
        },
      },
      {
        name: 'effort_override',
        sql: {
          sqlite: `ALTER TABLE tickets ADD COLUMN effort_override TEXT`,
          pgsql: `ALTER TABLE tickets ADD COLUMN effort_override TEXT`,
          supabase: `ALTER TABLE tickets ADD COLUMN effort_override TEXT`,
        },
      },
      {
        name: 'fast_mode',
        sql: {
          sqlite: `ALTER TABLE tickets ADD COLUMN fast_mode INTEGER NOT NULL DEFAULT 0`,
          pgsql: `ALTER TABLE tickets ADD COLUMN fast_mode BOOLEAN NOT NULL DEFAULT FALSE`,
          supabase: `ALTER TABLE tickets ADD COLUMN fast_mode BOOLEAN NOT NULL DEFAULT FALSE`,
        },
      },
    ];

    for (const col of cols) {
      const stmt = ctx.dialect({ ...col.sql });
      if (!stmt) continue;
      try {
        await ctx.exec(stmt);
      } catch {
        // Column may already exist (idempotent re-run).
      }
    }
  },

  async down(ctx) {
    // SQLite doesn't support DROP COLUMN in older versions; skip for safety.
    if (ctx.adapter === 'sqlite') return;
    for (const name of ['conversation_mode', 'model_override', 'effort_override', 'fast_mode']) {
      await ctx.exec(`ALTER TABLE tickets DROP COLUMN IF EXISTS ${name}`);
    }
  },
};

export default migration;
