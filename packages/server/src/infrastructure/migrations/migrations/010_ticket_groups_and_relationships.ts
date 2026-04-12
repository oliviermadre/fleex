import type { Migration } from '../types.js';

const migration: Migration = {
  name: '010_ticket_groups_and_relationships',

  async up(ctx) {
    if (ctx.adapter === 'json') return;

    // ── ticket_groups ──
    const createTicketGroups = ctx.dialect({
      sqlite: `CREATE TABLE IF NOT EXISTS ticket_groups (
        id TEXT PRIMARY KEY,
        board_id TEXT NOT NULL,
        name TEXT NOT NULL,
        emoji TEXT NOT NULL DEFAULT '📌',
        color TEXT NOT NULL DEFAULT 'fleex-purple',
        description TEXT NOT NULL DEFAULT '',
        timeframe TEXT NOT NULL DEFAULT 'now',
        group_status TEXT NOT NULL DEFAULT 'active',
        blocked INTEGER NOT NULL DEFAULT 0,
        favorite INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
      )`,
      pgsql: `CREATE TABLE IF NOT EXISTS ticket_groups (
        id TEXT PRIMARY KEY,
        board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        emoji TEXT NOT NULL DEFAULT '📌',
        color TEXT NOT NULL DEFAULT 'fleex-purple',
        description TEXT NOT NULL DEFAULT '',
        timeframe TEXT NOT NULL DEFAULT 'now',
        group_status TEXT NOT NULL DEFAULT 'active',
        blocked BOOLEAN NOT NULL DEFAULT FALSE,
        favorite BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      supabase: `CREATE TABLE IF NOT EXISTS ticket_groups (
        id TEXT PRIMARY KEY,
        board_id TEXT NOT NULL,
        name TEXT NOT NULL,
        emoji TEXT NOT NULL DEFAULT '📌',
        color TEXT NOT NULL DEFAULT 'fleex-purple',
        description TEXT NOT NULL DEFAULT '',
        timeframe TEXT NOT NULL DEFAULT 'now',
        group_status TEXT NOT NULL DEFAULT 'active',
        blocked BOOLEAN NOT NULL DEFAULT FALSE,
        favorite BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
    });
    if (createTicketGroups) await ctx.exec(createTicketGroups);

    // ── ticket_group_memberships ──
    const createMemberships = ctx.dialect({
      sqlite: `CREATE TABLE IF NOT EXISTS ticket_group_memberships (
        ticket_id TEXT NOT NULL,
        group_id TEXT NOT NULL,
        PRIMARY KEY (ticket_id, group_id),
        FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
        FOREIGN KEY (group_id) REFERENCES ticket_groups(id) ON DELETE CASCADE
      )`,
      pgsql: `CREATE TABLE IF NOT EXISTS ticket_group_memberships (
        ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        group_id TEXT NOT NULL REFERENCES ticket_groups(id) ON DELETE CASCADE,
        PRIMARY KEY (ticket_id, group_id)
      )`,
      supabase: `CREATE TABLE IF NOT EXISTS ticket_group_memberships (
        ticket_id TEXT NOT NULL,
        group_id TEXT NOT NULL,
        PRIMARY KEY (ticket_id, group_id)
      )`,
    });
    if (createMemberships) await ctx.exec(createMemberships);

    // ── ticket_relationships ──
    const createRelationships = ctx.dialect({
      sqlite: `CREATE TABLE IF NOT EXISTS ticket_relationships (
        parent_id TEXT NOT NULL,
        child_id TEXT NOT NULL,
        PRIMARY KEY (parent_id, child_id),
        FOREIGN KEY (parent_id) REFERENCES tickets(id) ON DELETE CASCADE,
        FOREIGN KEY (child_id) REFERENCES tickets(id) ON DELETE CASCADE
      )`,
      pgsql: `CREATE TABLE IF NOT EXISTS ticket_relationships (
        parent_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        child_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        PRIMARY KEY (parent_id, child_id)
      )`,
      supabase: `CREATE TABLE IF NOT EXISTS ticket_relationships (
        parent_id TEXT NOT NULL,
        child_id TEXT NOT NULL,
        PRIMARY KEY (parent_id, child_id)
      )`,
    });
    if (createRelationships) await ctx.exec(createRelationships);

    // ── Indexes ──
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_ticket_groups_board ON ticket_groups(board_id)',
      'CREATE INDEX IF NOT EXISTS idx_ticket_groups_status ON ticket_groups(group_status)',
      'CREATE INDEX IF NOT EXISTS idx_tgm_group ON ticket_group_memberships(group_id)',
      'CREATE INDEX IF NOT EXISTS idx_tgm_ticket ON ticket_group_memberships(ticket_id)',
      'CREATE INDEX IF NOT EXISTS idx_ticket_rel_parent ON ticket_relationships(parent_id)',
      'CREATE INDEX IF NOT EXISTS idx_ticket_rel_child ON ticket_relationships(child_id)',
    ];

    for (const idx of indexes) {
      const sql = ctx.dialect({ sqlite: idx, pgsql: idx, supabase: idx });
      if (sql) await ctx.exec(sql);
    }
  },

  async down(ctx) {
    if (ctx.adapter === 'json') return;

    const tables = ['ticket_relationships', 'ticket_group_memberships', 'ticket_groups'];
    for (const table of tables) {
      const sql = ctx.dialect({
        sqlite: `DROP TABLE IF EXISTS ${table}`,
        pgsql: `DROP TABLE IF EXISTS ${table} CASCADE`,
        supabase: `DROP TABLE IF EXISTS ${table} CASCADE`,
      });
      if (sql) await ctx.exec(sql);
    }
  },
};

export default migration;
