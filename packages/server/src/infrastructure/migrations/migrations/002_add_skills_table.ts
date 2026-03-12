import type { Migration } from '../types.js';

/**
 * Migration 002: Add skills table for reusable markdown workflows.
 */
const migration: Migration = {
  name: '002_add_skills_table',

  async up(ctx) {
    // ── Skills table ──
    const skillsSql = ctx.dialect({
      sqlite: `CREATE TABLE IF NOT EXISTS skills (
        id TEXT PRIMARY KEY,
        command_name TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        display_name TEXT NOT NULL,
        markdown_content TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 1,
        persona_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      pgsql: `CREATE TABLE IF NOT EXISTS skills (
        id TEXT PRIMARY KEY,
        command_name TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        display_name TEXT NOT NULL,
        markdown_content TEXT NOT NULL DEFAULT '',
        enabled BOOLEAN NOT NULL DEFAULT true,
        persona_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      )`,
      supabase: `CREATE TABLE IF NOT EXISTS skills (
        id TEXT PRIMARY KEY,
        command_name TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        display_name TEXT NOT NULL,
        markdown_content TEXT NOT NULL DEFAULT '',
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        persona_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      )`,
      json: null,
    });
    if (skillsSql) await ctx.exec(skillsSql);

    // ── Indexes ──
    if (ctx.adapter !== 'json') {
      await ctx.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_skills_command_name ON skills(command_name)');
      await ctx.exec('CREATE INDEX IF NOT EXISTS idx_skills_persona_id ON skills(persona_id)');
    }

    // ── Supabase RLS ──
    if (ctx.adapter === 'supabase') {
      await ctx.exec('ALTER TABLE skills ENABLE ROW LEVEL SECURITY');
      await ctx.exec(`CREATE POLICY "service_role_skills" ON skills FOR ALL USING (true) WITH CHECK (true)`);
    }
  },

  async down(ctx) {
    if (ctx.adapter === 'json') return;
    await ctx.exec('DROP TABLE IF EXISTS skills');
  },
};

export default migration;
