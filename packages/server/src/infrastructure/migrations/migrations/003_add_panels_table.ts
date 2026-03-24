import type { Migration } from '../types.js';

/**
 * Migration 003: Add panels table for multi-agent orchestration.
 */
const migration: Migration = {
  name: '003_add_panels_table',

  async up(ctx) {
    // ── Panels table ──
    const panelsSql = ctx.dialect({
      sqlite: `CREATE TABLE IF NOT EXISTS panels (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        members TEXT NOT NULL DEFAULT '[]',
        orchestrator_prompt TEXT NOT NULL DEFAULT '',
        orchestrator_model TEXT NOT NULL DEFAULT 'claude-sonnet-4-5-20250929',
        default_member_model TEXT NOT NULL DEFAULT 'claude-sonnet-4-5-20250929',
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      pgsql: `CREATE TABLE IF NOT EXISTS panels (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        members JSONB NOT NULL DEFAULT '[]',
        orchestrator_prompt TEXT NOT NULL DEFAULT '',
        orchestrator_model TEXT NOT NULL DEFAULT 'claude-sonnet-4-5-20250929',
        default_member_model TEXT NOT NULL DEFAULT 'claude-sonnet-4-5-20250929',
        enabled BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      )`,
      supabase: `CREATE TABLE IF NOT EXISTS panels (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        members JSONB NOT NULL DEFAULT '[]',
        orchestrator_prompt TEXT NOT NULL DEFAULT '',
        orchestrator_model TEXT NOT NULL DEFAULT 'claude-sonnet-4-5-20250929',
        default_member_model TEXT NOT NULL DEFAULT 'claude-sonnet-4-5-20250929',
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      )`,
      json: null,
    });
    if (panelsSql) await ctx.exec(panelsSql);

    // ── Indexes ──
    if (ctx.adapter !== 'json') {
      await ctx.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_panels_name ON panels(name)');
    }

    // ── Supabase RLS ──
    if (ctx.adapter === 'supabase') {
      await ctx.exec('ALTER TABLE panels ENABLE ROW LEVEL SECURITY');
      await ctx.exec(`CREATE POLICY "service_role_panels" ON panels FOR ALL USING (true) WITH CHECK (true)`);
    }
  },

  async down(ctx) {
    if (ctx.adapter === 'json') return;
    await ctx.exec('DROP TABLE IF EXISTS panels');
  },
};

export default migration;
