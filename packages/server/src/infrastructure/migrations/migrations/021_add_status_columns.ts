import { DEFAULT_STATUS_MODEL } from '@fleex/shared';
import type { Migration } from '../types.js';

/**
 * Add the `status_columns` table: the persisted kanban status model (column
 * keys + semantic roles). Seeded with the six built-in statuses so behaviour is
 * unchanged. SQLite + PostgreSQL + Supabase (with RLS); JSON adapter persists
 * to a file and skips DB work.
 *
 * `anchors` is stored as a JSON-encoded TEXT array on every dialect so adapters
 * parse it uniformly. Booleans use each dialect's native representation.
 */
const migration: Migration = {
  name: '021_add_status_columns',

  async up(ctx) {
    if (ctx.adapter === 'json') return;

    const boolType = ctx.dialect({ sqlite: 'INTEGER', pgsql: 'BOOLEAN', supabase: 'BOOLEAN' });
    const boolFalse = ctx.dialect({ sqlite: 'DEFAULT 0', pgsql: 'DEFAULT FALSE', supabase: 'DEFAULT FALSE' });

    await ctx.exec(`
      CREATE TABLE IF NOT EXISTS status_columns (
        key TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        position INTEGER NOT NULL,
        startable ${boolType} NOT NULL ${boolFalse},
        active ${boolType} NOT NULL ${boolFalse},
        terminal ${boolType} NOT NULL ${boolFalse},
        outcome TEXT,
        anchors TEXT NOT NULL DEFAULT '[]',
        collapsed_by_default ${boolType} NOT NULL ${boolFalse}
      )
    `);
    await ctx.exec('CREATE INDEX IF NOT EXISTS idx_status_columns_position ON status_columns(position)');

    // Seed the built-in model so existing boards keep their six columns.
    const bool = (v: boolean) => (ctx.adapter === 'sqlite' ? (v ? '1' : '0') : (v ? 'TRUE' : 'FALSE'));
    const text = (v: string | null) => (v === null ? 'NULL' : `'${v.replace(/'/g, "''")}'`);

    for (const c of DEFAULT_STATUS_MODEL.columns) {
      await ctx.exec(`
        INSERT INTO status_columns (key, label, position, startable, active, terminal, outcome, anchors, collapsed_by_default)
        VALUES (
          ${text(c.key)}, ${text(c.label)}, ${c.order},
          ${bool(c.startable)}, ${bool(c.active)}, ${bool(c.terminal)},
          ${text(c.outcome)}, ${text(JSON.stringify(c.anchors))}, ${bool(c.collapsedByDefault)}
        )
      `);
    }

    // Supabase RLS (cf. CLAUDE.md)
    if (ctx.adapter === 'supabase') {
      await ctx.exec('ALTER TABLE status_columns ENABLE ROW LEVEL SECURITY');
      await ctx.exec(`CREATE POLICY "service_role_status_columns" ON status_columns FOR ALL USING (true) WITH CHECK (true)`);
    }
  },

  async down(ctx) {
    if (ctx.adapter === 'json') return;
    await ctx.exec('DROP TABLE IF EXISTS status_columns');
  },
};

export default migration;
