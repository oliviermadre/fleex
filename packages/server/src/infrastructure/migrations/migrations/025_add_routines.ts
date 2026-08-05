import type { Migration, MigrationContext } from '../types.js';

/**
 * Routines — workflow executions that are not anchored to a ticket.
 *
 * Two things happen here:
 *  1. the `routines` table is created;
 *  2. the three `ticket_id` columns that made a ticket mandatory for *any*
 *     agentic execution are relaxed to nullable, and given the alternate
 *     anchors (`routine_id`, `workflow_run_id`) a routine run needs.
 *
 * SQLite cannot `ALTER COLUMN … DROP NOT NULL`, so those three tables are
 * rebuilt — see `dropTicketIdNotNull`.
 */

/**
 * SQLite's documented table-rebuild, driven by the table's own stored DDL
 * rather than a hand-written column list.
 *
 * Enumerating the columns by hand was the obvious alternative and was rejected:
 * `agent_event_executions` has been extended by nine prior migrations, so a
 * hard-coded list would silently drop whichever column the author forgot.
 * Rewriting `sqlite_master` in place via `PRAGMA writable_schema` was also
 * tried and does not work — SQLite's defensive mode (on by default in
 * bun:sqlite) rejects the write outright.
 *
 * Idempotent: when the DDL no longer contains `ticket_id … NOT NULL` there is
 * nothing to rebuild and the function returns.
 */
async function dropTicketIdNotNull(ctx: MigrationContext, table: string): Promise<void> {
  const [row] = await ctx.query(
    `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = '${table}'`,
  );
  const ddl = typeof row?.['sql'] === 'string' ? row['sql'] : null;
  if (!ddl) return;

  const relaxed = ddl.replace(/(\bticket_id\s+TEXT)\s+NOT\s+NULL/i, '$1');
  if (relaxed === ddl) return; // already nullable

  // Indexes are dropped along with the table, so their DDL is captured first
  // and replayed after the rename. Auto-indexes (UNIQUE/PK) have a null `sql`
  // and are recreated by the CREATE TABLE itself.
  const indexRows = await ctx.query(
    `SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = '${table}' AND sql IS NOT NULL`,
  );

  const tmp = `${table}__routines_rebuild`;
  await ctx.exec('PRAGMA foreign_keys=OFF');
  await ctx.exec(relaxed.replace(
    new RegExp(`CREATE\\s+TABLE\\s+(IF\\s+NOT\\s+EXISTS\\s+)?["'\`]?${table}["'\`]?`, 'i'),
    `CREATE TABLE ${tmp}`,
  ));
  await ctx.exec(`INSERT INTO ${tmp} SELECT * FROM ${table}`);
  await ctx.exec(`DROP TABLE ${table}`);
  await ctx.exec(`ALTER TABLE ${tmp} RENAME TO ${table}`);
  for (const idx of indexRows) {
    if (typeof idx['sql'] === 'string') await ctx.exec(idx['sql']);
  }
  await ctx.exec('PRAGMA foreign_keys=ON');
}
const migration: Migration = {
  name: '025_add_routines',

  async up(ctx) {
    const jsonType = ctx.dialect({ sqlite: 'TEXT', pgsql: 'JSONB', supabase: 'JSONB' });
    const tsType = ctx.dialect({ sqlite: 'TEXT', pgsql: 'TIMESTAMPTZ', supabase: 'TIMESTAMPTZ' });
    const tsDefault = ctx.dialect({
      sqlite: "DEFAULT (datetime('now'))",
      pgsql: 'DEFAULT NOW()',
      supabase: 'DEFAULT NOW()',
    });
    const boolType = ctx.dialect({ sqlite: 'INTEGER', pgsql: 'BOOLEAN', supabase: 'BOOLEAN' });
    const boolTrueDefault = ctx.dialect({ sqlite: 'DEFAULT 1', pgsql: 'DEFAULT TRUE', supabase: 'DEFAULT TRUE' });

    // ── 1. routines ────────────────────────────────────────────────────────
    await ctx.exec(`
      CREATE TABLE IF NOT EXISTS routines (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        emoji TEXT NOT NULL DEFAULT '',
        description TEXT,
        enabled ${boolType} NOT NULL ${boolTrueDefault},
        template_id TEXT NOT NULL REFERENCES workflow_templates(id) ON DELETE CASCADE,
        subject ${jsonType} NOT NULL,
        trigger_kind TEXT NOT NULL DEFAULT 'manual',
        cron TEXT,
        run_at ${tsType},
        timezone TEXT NOT NULL DEFAULT 'Europe/Paris',
        overlap_policy TEXT NOT NULL DEFAULT 'skip',
        last_run_at ${tsType},
        last_run_id TEXT,
        next_run_at ${tsType},
        created_at ${tsType} NOT NULL ${tsDefault},
        updated_at ${tsType} NOT NULL ${tsDefault}
      )
    `);
    await ctx.exec('CREATE INDEX IF NOT EXISTS idx_routines_next_run ON routines(enabled, next_run_at)');

    // ── 2. workflow_runs: new anchors ──────────────────────────────────────
    for (const col of [
      'routine_id TEXT',
      `subject_snapshot ${jsonType}`,
      'workspace_path TEXT',
    ]) {
      try {
        await ctx.exec(`ALTER TABLE workflow_runs ADD COLUMN ${col}`);
      } catch {
        // Column already exists (idempotent re-run).
      }
    }
    await ctx.exec('CREATE INDEX IF NOT EXISTS idx_workflow_runs_routine ON workflow_runs(routine_id, status)');

    // ── 3. agent_event_executions / deliverables: alternate anchors ────────
    for (const stmt of [
      'ALTER TABLE agent_event_executions ADD COLUMN routine_id TEXT',
      'ALTER TABLE agent_event_executions ADD COLUMN workflow_run_id TEXT',
      'ALTER TABLE deliverables ADD COLUMN workflow_run_id TEXT',
    ]) {
      try {
        await ctx.exec(stmt);
      } catch {
        // Column already exists (idempotent re-run).
      }
    }
    await ctx.exec('CREATE INDEX IF NOT EXISTS idx_deliverables_workflow_run ON deliverables(workflow_run_id)');
    await ctx.exec('CREATE INDEX IF NOT EXISTS idx_agent_executions_routine ON agent_event_executions(routine_id)');

    // ── 4. relax the mandatory ticket ──────────────────────────────────────
    if (ctx.adapter === 'sqlite') {
      for (const table of ['workflow_runs', 'agent_event_executions', 'deliverables']) {
        await dropTicketIdNotNull(ctx, table);
      }
    } else {
      for (const table of ['workflow_runs', 'agent_event_executions', 'deliverables']) {
        await ctx.exec(`ALTER TABLE ${table} ALTER COLUMN ticket_id DROP NOT NULL`);
      }
      // Exactly one anchor. Enforced in the domain layer for every adapter; the
      // constraint is added here too where the dialect allows it.
      await ctx.exec(`
        ALTER TABLE workflow_runs
          ADD CONSTRAINT workflow_runs_single_anchor
          CHECK ((ticket_id IS NULL) <> (routine_id IS NULL))
      `);
    }

    // Supabase RLS (cf. CLAUDE.md)
    if (ctx.adapter === 'supabase') {
      await ctx.exec('ALTER TABLE routines ENABLE ROW LEVEL SECURITY');
      await ctx.exec(`CREATE POLICY "service_role_routines" ON routines FOR ALL USING (true) WITH CHECK (true)`);
    }
  },

  async down(ctx) {
    await ctx.exec('DROP TABLE IF EXISTS routines');
    if (ctx.adapter !== 'sqlite') {
      await ctx.exec('ALTER TABLE workflow_runs DROP CONSTRAINT IF EXISTS workflow_runs_single_anchor');
      await ctx.exec('ALTER TABLE workflow_runs DROP COLUMN IF EXISTS routine_id');
      await ctx.exec('ALTER TABLE workflow_runs DROP COLUMN IF EXISTS subject_snapshot');
      await ctx.exec('ALTER TABLE workflow_runs DROP COLUMN IF EXISTS workspace_path');
      await ctx.exec('ALTER TABLE agent_event_executions DROP COLUMN IF EXISTS routine_id');
      await ctx.exec('ALTER TABLE agent_event_executions DROP COLUMN IF EXISTS workflow_run_id');
      await ctx.exec('ALTER TABLE deliverables DROP COLUMN IF EXISTS workflow_run_id');
    }
    // SQLite: columns and the relaxed NOT NULL are left in place — dropping
    // them would require the very table rebuild this migration avoids, and a
    // nullable column with no writer is inert.
  },
};

export default migration;
