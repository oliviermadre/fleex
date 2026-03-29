import type { Migration } from '../types.js';

const migration: Migration = {
  name: '009_add_deliverable_excluded_from_context',

  async up(ctx) {
    if (ctx.adapter === 'json') return;

    const sql = 'ALTER TABLE deliverables ADD COLUMN excluded_from_context INTEGER NOT NULL DEFAULT 0';
    const dialectSql = ctx.dialect({ sqlite: sql, pgsql: sql, supabase: sql, json: null });
    if (dialectSql) await ctx.exec(dialectSql);
  },

  async down(ctx) {
    if (ctx.adapter === 'json') return;
  },
};

export default migration;
