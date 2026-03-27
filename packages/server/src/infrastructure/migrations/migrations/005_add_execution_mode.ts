import type { Migration } from '../types.js';

const migration: Migration = {
  name: '005_add_execution_mode',

  async up(ctx) {
    if (ctx.adapter === 'json') return;

    const personaSql = ctx.dialect({
      sqlite: `ALTER TABLE agent_personas ADD COLUMN execution_mode TEXT NOT NULL DEFAULT 'claude_code'`,
      pgsql: `ALTER TABLE agent_personas ADD COLUMN execution_mode TEXT NOT NULL DEFAULT 'claude_code'`,
      supabase: `ALTER TABLE agent_personas ADD COLUMN execution_mode TEXT NOT NULL DEFAULT 'claude_code'`,
      json: null,
    });
    if (personaSql) await ctx.exec(personaSql);

    const panelSql = ctx.dialect({
      sqlite: `ALTER TABLE panels ADD COLUMN execution_mode TEXT NOT NULL DEFAULT 'claude_code'`,
      pgsql: `ALTER TABLE panels ADD COLUMN execution_mode TEXT NOT NULL DEFAULT 'claude_code'`,
      supabase: `ALTER TABLE panels ADD COLUMN execution_mode TEXT NOT NULL DEFAULT 'claude_code'`,
      json: null,
    });
    if (panelSql) await ctx.exec(panelSql);

    const mentionSql = ctx.dialect({
      sqlite: `ALTER TABLE mentions ADD COLUMN execution_mode TEXT NOT NULL DEFAULT 'plan'`,
      pgsql: `ALTER TABLE mentions ADD COLUMN execution_mode TEXT NOT NULL DEFAULT 'plan'`,
      supabase: `ALTER TABLE mentions ADD COLUMN execution_mode TEXT NOT NULL DEFAULT 'plan'`,
      json: null,
    });
    if (mentionSql) await ctx.exec(mentionSql);
  },

  async down(ctx) {
    if (ctx.adapter === 'json') return;
    // SQLite doesn't support DROP COLUMN before 3.35.0 — safe to skip
  },
};

export default migration;
