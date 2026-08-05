import type { Migration, MigrationContext } from '../types.js';

/**
 * Routines can target any agentic primitive, not only a workflow template:
 * `target_kind` ('workflow' | 'agent' | 'skill' | 'panel') plus `target_ref`
 * (persona name / skill command / panel name) join the existing `template_id`,
 * which keeps holding the ref — and its FK + cascade — for workflow targets.
 *
 * Consequence: `template_id` can no longer be NOT NULL, neither on `routines`
 * (a routine may target a persona instead) nor on `workflow_runs` (a primitive
 * run is synthesized from the routine at launch and has no template row).
 * SQLite cannot `ALTER COLUMN … DROP NOT NULL`, so both tables are rebuilt —
 * same technique as migration 025's `dropTicketIdNotNull`.
 */

/**
 * SQLite's documented table-rebuild, driven by the table's own stored DDL
 * rather than a hand-written column list (see migration 025 for why).
 * Idempotent: returns when the column is already nullable.
 */
async function dropColumnNotNull(ctx: MigrationContext, table: string, column: string): Promise<void> {
  const [row] = await ctx.query(
    `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = '${table}'`,
  );
  const ddl = typeof row?.['sql'] === 'string' ? row['sql'] : null;
  if (!ddl) return;

  const relaxed = ddl.replace(new RegExp(`(\\b${column}\\s+TEXT)\\s+NOT\\s+NULL`, 'i'), '$1');
  if (relaxed === ddl) return; // already nullable

  const indexRows = await ctx.query(
    `SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = '${table}' AND sql IS NOT NULL`,
  );

  const tmp = `${table}__target_rebuild`;
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
  name: '027_routine_primitive_targets',

  async up(ctx) {
    for (const col of [
      "target_kind TEXT NOT NULL DEFAULT 'workflow'",
      'target_ref TEXT',
    ]) {
      try {
        await ctx.exec(`ALTER TABLE routines ADD COLUMN ${col}`);
      } catch {
        // Column already exists (idempotent re-run).
      }
    }

    if (ctx.adapter === 'sqlite') {
      await dropColumnNotNull(ctx, 'routines', 'template_id');
      await dropColumnNotNull(ctx, 'workflow_runs', 'template_id');
    } else {
      await ctx.exec('ALTER TABLE routines ALTER COLUMN template_id DROP NOT NULL');
      await ctx.exec('ALTER TABLE workflow_runs ALTER COLUMN template_id DROP NOT NULL');
    }
  },

  async down(ctx) {
    if (ctx.adapter !== 'sqlite') {
      await ctx.exec('ALTER TABLE routines DROP COLUMN IF EXISTS target_kind');
      await ctx.exec('ALTER TABLE routines DROP COLUMN IF EXISTS target_ref');
    }
    // SQLite: the added columns and the relaxed NOT NULL are left in place —
    // removing them would require the very rebuild this migration exists to
    // avoid on downgrade, and a nullable column with no writer is inert.
  },
};

export default migration;
