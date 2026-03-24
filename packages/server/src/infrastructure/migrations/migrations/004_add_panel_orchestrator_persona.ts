import type { Migration } from '../types.js';

const migration: Migration = {
  name: '004_add_panel_orchestrator_persona',

  async up(ctx) {
    if (ctx.adapter === 'json') return;

    const sql = ctx.dialect({
      sqlite: `ALTER TABLE panels ADD COLUMN orchestrator_persona_id TEXT DEFAULT NULL`,
      pgsql: `ALTER TABLE panels ADD COLUMN orchestrator_persona_id TEXT DEFAULT NULL`,
      supabase: `ALTER TABLE panels ADD COLUMN orchestrator_persona_id TEXT DEFAULT NULL`,
      json: null,
    });
    if (sql) await ctx.exec(sql);
  },

  async down(ctx) {
    if (ctx.adapter === 'json') return;
    // SQLite doesn't support DROP COLUMN before 3.35.0 — safe to skip
  },
};

export default migration;
