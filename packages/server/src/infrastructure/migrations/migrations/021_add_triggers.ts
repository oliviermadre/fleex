import type { Migration } from '../types.js';

/**
 * Add trigger tables: triggers (persisted, user-configured launchers) and
 * trigger_runs (per-firing execution log).
 *
 * `kind` + `config` (JSON) make this forward-compatible with future
 * event/webhook launchers without a schema change. Mirrors the dialect
 * handling of 018_add_workflows (SQLite / PostgreSQL / Supabase + RLS).
 */
const migration: Migration = {
  name: '021_add_triggers',

  async up(ctx) {
    if (ctx.adapter === 'json') return;

    const jsonType = ctx.dialect({ sqlite: 'TEXT', pgsql: 'JSONB', supabase: 'JSONB' });
    const tsType = ctx.dialect({ sqlite: 'TEXT', pgsql: 'TIMESTAMPTZ', supabase: 'TIMESTAMPTZ' });
    const tsDefault = ctx.dialect({
      sqlite: "DEFAULT (datetime('now'))",
      pgsql: 'DEFAULT NOW()',
      supabase: 'DEFAULT NOW()',
    });
    const boolType = ctx.dialect({ sqlite: 'INTEGER', pgsql: 'BOOLEAN', supabase: 'BOOLEAN' });
    const boolTrueDefault = ctx.dialect({ sqlite: 'DEFAULT 1', pgsql: 'DEFAULT TRUE', supabase: 'DEFAULT TRUE' });

    // triggers
    await ctx.exec(`
      CREATE TABLE IF NOT EXISTS triggers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        emoji TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL DEFAULT 'cron',
        config ${jsonType} NOT NULL,
        description_md TEXT NOT NULL DEFAULT '',
        target_type TEXT NOT NULL,
        target_ref TEXT NOT NULL,
        mode TEXT NOT NULL DEFAULT 'plan',
        enabled ${boolType} NOT NULL ${boolTrueDefault},
        next_run_at ${tsType},
        last_run_at ${tsType},
        last_status TEXT,
        created_at ${tsType} NOT NULL ${tsDefault},
        updated_at ${tsType} NOT NULL ${tsDefault}
      )
    `);
    await ctx.exec('CREATE INDEX IF NOT EXISTS idx_triggers_next_run ON triggers(next_run_at, enabled)');

    // trigger_runs
    await ctx.exec(`
      CREATE TABLE IF NOT EXISTS trigger_runs (
        id TEXT PRIMARY KEY,
        trigger_id TEXT NOT NULL REFERENCES triggers(id) ON DELETE CASCADE,
        scheduled_for ${tsType} NOT NULL,
        status TEXT NOT NULL,
        workflow_run_id TEXT,
        execution_id TEXT,
        workspace_path TEXT,
        error TEXT,
        started_at ${tsType},
        completed_at ${tsType},
        created_at ${tsType} NOT NULL ${tsDefault}
      )
    `);
    await ctx.exec('CREATE INDEX IF NOT EXISTS idx_trigger_runs_trigger ON trigger_runs(trigger_id)');

    // Supabase RLS (cf. CLAUDE.md)
    if (ctx.adapter === 'supabase') {
      await ctx.exec('ALTER TABLE triggers ENABLE ROW LEVEL SECURITY');
      await ctx.exec(`CREATE POLICY "service_role_triggers" ON triggers FOR ALL USING (true) WITH CHECK (true)`);
      await ctx.exec('ALTER TABLE trigger_runs ENABLE ROW LEVEL SECURITY');
      await ctx.exec(`CREATE POLICY "service_role_trigger_runs" ON trigger_runs FOR ALL USING (true) WITH CHECK (true)`);
    }
  },

  async down(ctx) {
    if (ctx.adapter === 'json') return;
    await ctx.exec('DROP TABLE IF EXISTS trigger_runs');
    await ctx.exec('DROP TABLE IF EXISTS triggers');
  },
};

export default migration;
