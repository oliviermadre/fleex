import type { Migration } from '../types.js';

const migration: Migration = {
  name: '004_add_panel_orchestrator_persona',

  async up(ctx) {

    const sql = ctx.dialect({
      sqlite: `ALTER TABLE panels ADD COLUMN orchestrator_persona_id TEXT DEFAULT NULL`,
      pgsql: `ALTER TABLE panels ADD COLUMN orchestrator_persona_id TEXT DEFAULT NULL`,
      supabase: `ALTER TABLE panels ADD COLUMN orchestrator_persona_id TEXT DEFAULT NULL`,
    });
    if (sql) await ctx.exec(sql);
  },

  async down(ctx) {
    // SQLite doesn't support DROP COLUMN before 3.35.0 — safe to skip
  },
};

export default migration;
