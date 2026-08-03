import type { Migration } from '../types.js';

const migration: Migration = {
  name: '012_ticket_group_boards',

  async up(ctx) {

    // Create junction table
    const createTable = ctx.dialect({
      sqlite: `CREATE TABLE IF NOT EXISTS ticket_group_boards (
        group_id TEXT NOT NULL,
        board_id TEXT NOT NULL,
        PRIMARY KEY (group_id, board_id),
        FOREIGN KEY (group_id) REFERENCES ticket_groups(id) ON DELETE CASCADE,
        FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
      )`,
      pgsql: `CREATE TABLE IF NOT EXISTS ticket_group_boards (
        group_id TEXT NOT NULL REFERENCES ticket_groups(id) ON DELETE CASCADE,
        board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
        PRIMARY KEY (group_id, board_id)
      )`,
      supabase: `CREATE TABLE IF NOT EXISTS ticket_group_boards (
        group_id TEXT NOT NULL,
        board_id TEXT NOT NULL,
        PRIMARY KEY (group_id, board_id)
      )`,
    });
    if (createTable) await ctx.exec(createTable);

    // Populate from existing board_id column
    const populate = ctx.dialect({
      sqlite: `INSERT OR IGNORE INTO ticket_group_boards (group_id, board_id) SELECT id, board_id FROM ticket_groups WHERE board_id IS NOT NULL AND board_id != ''`,
      pgsql: `INSERT INTO ticket_group_boards (group_id, board_id) SELECT id, board_id FROM ticket_groups WHERE board_id IS NOT NULL AND board_id != '' ON CONFLICT DO NOTHING`,
      supabase: `INSERT INTO ticket_group_boards (group_id, board_id) SELECT id, board_id FROM ticket_groups WHERE board_id IS NOT NULL AND board_id != '' ON CONFLICT DO NOTHING`,
    });
    if (populate) await ctx.exec(populate);

    // Make board_id nullable (pgsql/supabase only — sqlite can't ALTER columns)
    if (ctx.adapter === 'pgsql' || ctx.adapter === 'supabase') {
      try {
        await ctx.exec('ALTER TABLE ticket_groups ALTER COLUMN board_id DROP NOT NULL');
      } catch {
        // Column may already be nullable
      }
    }

    // Indexes
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_tgb_group ON ticket_group_boards(group_id)',
      'CREATE INDEX IF NOT EXISTS idx_tgb_board ON ticket_group_boards(board_id)',
    ];
    for (const idx of indexes) {
      const sql = ctx.dialect({ sqlite: idx, pgsql: idx, supabase: idx });
      if (sql) await ctx.exec(sql);
    }

    // Supabase RLS
    if (ctx.adapter === 'supabase') {
      await ctx.exec('ALTER TABLE ticket_group_boards ENABLE ROW LEVEL SECURITY');
      await ctx.exec(`CREATE POLICY "service_role_ticket_group_boards" ON ticket_group_boards FOR ALL USING (true) WITH CHECK (true)`);
    }
  },

  async down(ctx) {
    const sql = ctx.dialect({
      sqlite: 'DROP TABLE IF EXISTS ticket_group_boards',
      pgsql: 'DROP TABLE IF EXISTS ticket_group_boards CASCADE',
      supabase: 'DROP TABLE IF EXISTS ticket_group_boards CASCADE',
    });
    if (sql) await ctx.exec(sql);
  },
};

export default migration;
