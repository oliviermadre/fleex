import type { Migration } from '../types.js';

/**
 * Add workflow tables: workflow_templates, workflow_runs, step_runs.
 * Supports SQLite (json adapter computes nothing) + PostgreSQL + Supabase (with RLS).
 */
const migration: Migration = {
  name: '018_add_workflows',

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

    // workflow_templates
    await ctx.exec(`
      CREATE TABLE IF NOT EXISTS workflow_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        emoji TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        steps ${jsonType} NOT NULL,
        edges ${jsonType} NOT NULL,
        entry_step_id TEXT NOT NULL,
        enabled ${boolType} NOT NULL ${boolTrueDefault},
        created_at ${tsType} NOT NULL ${tsDefault},
        updated_at ${tsType} NOT NULL ${tsDefault}
      )
    `);

    // workflow_runs
    await ctx.exec(`
      CREATE TABLE IF NOT EXISTS workflow_runs (
        id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        template_id TEXT NOT NULL REFERENCES workflow_templates(id),
        template_snapshot ${jsonType} NOT NULL,
        status TEXT NOT NULL,
        current_step_id TEXT,
        triggered_by TEXT NOT NULL,
        triggered_from TEXT NOT NULL,
        started_at ${tsType} NOT NULL ${tsDefault},
        completed_at ${tsType},
        created_at ${tsType} NOT NULL ${tsDefault},
        updated_at ${tsType} NOT NULL ${tsDefault}
      )
    `);
    await ctx.exec('CREATE INDEX IF NOT EXISTS idx_workflow_runs_ticket_status ON workflow_runs(ticket_id, status)');

    // step_runs
    await ctx.exec(`
      CREATE TABLE IF NOT EXISTS step_runs (
        id TEXT PRIMARY KEY,
        workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
        step_id TEXT NOT NULL,
        attempt INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL,
        result TEXT,
        output ${jsonType},
        next_edge_id TEXT,
        execution_id TEXT,
        started_at ${tsType},
        completed_at ${tsType},
        created_at ${tsType} NOT NULL ${tsDefault}
      )
    `);
    await ctx.exec('CREATE INDEX IF NOT EXISTS idx_step_runs_run_step ON step_runs(workflow_run_id, step_id)');

    // Supabase RLS (cf. CLAUDE.md)
    if (ctx.adapter === 'supabase') {
      await ctx.exec('ALTER TABLE workflow_templates ENABLE ROW LEVEL SECURITY');
      await ctx.exec(`CREATE POLICY "service_role_workflow_templates" ON workflow_templates FOR ALL USING (true) WITH CHECK (true)`);
      await ctx.exec('ALTER TABLE workflow_runs ENABLE ROW LEVEL SECURITY');
      await ctx.exec(`CREATE POLICY "service_role_workflow_runs" ON workflow_runs FOR ALL USING (true) WITH CHECK (true)`);
      await ctx.exec('ALTER TABLE step_runs ENABLE ROW LEVEL SECURITY');
      await ctx.exec(`CREATE POLICY "service_role_step_runs" ON step_runs FOR ALL USING (true) WITH CHECK (true)`);
    }
  },

  async down(ctx) {
    if (ctx.adapter === 'json') return;
    await ctx.exec('DROP TABLE IF EXISTS step_runs');
    await ctx.exec('DROP TABLE IF EXISTS workflow_runs');
    await ctx.exec('DROP TABLE IF EXISTS workflow_templates');
  },
};

export default migration;
