import type { Migration } from '../types.js';

/**
 * A ticket's shared todo list, edited by the human and the agents.
 *
 * - `ticket_todo_items`: one row per item. `ref` is a per-ticket number that is
 *   never reused (UNIQUE(ticket_id, ref), computed over deleted rows too).
 *   Delete is soft (`deleted_at`) so the history stays readable.
 * - `ticket_todo_events`: the audit trail, one row per change of one item
 *   (who, when, from where, `{field: {from, to}}`).
 * Deleting a ticket deletes both (FK cascade).
 */
const migration: Migration = {
  name: '042_ticket_todos',

  async up(ctx) {
    const ts = ctx.adapter === 'sqlite' ? 'TEXT' : 'TIMESTAMPTZ';
    const json = ctx.adapter === 'sqlite' ? 'TEXT' : 'JSONB';

    await ctx.exec(`CREATE TABLE IF NOT EXISTS ticket_todo_items (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      ref INTEGER NOT NULL,
      text TEXT NOT NULL,
      note TEXT,
      state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'done', 'cancelled')),
      position DOUBLE PRECISION NOT NULL,
      created_by_type TEXT NOT NULL CHECK (created_by_type IN ('user', 'agent')),
      created_by_name TEXT NOT NULL,
      state_changed_at ${ts},
      state_changed_by_type TEXT,
      state_changed_by_name TEXT,
      cancel_reason TEXT,
      created_at ${ts} NOT NULL,
      updated_at ${ts} NOT NULL,
      deleted_at ${ts},
      UNIQUE (ticket_id, ref)
    )`);
    await ctx.exec('CREATE INDEX IF NOT EXISTS idx_ticket_todo_items_ticket ON ticket_todo_items(ticket_id, deleted_at, position)');

    await ctx.exec(`CREATE TABLE IF NOT EXISTS ticket_todo_events (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL REFERENCES ticket_todo_items(id) ON DELETE CASCADE,
      ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      item_ref INTEGER NOT NULL,
      item_text TEXT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('created', 'edited', 'state_changed', 'moved', 'deleted')),
      changes ${json} NOT NULL,
      actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'agent')),
      actor_name TEXT NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('web', 'cli', 'mcp', 'agent-api')),
      created_at ${ts} NOT NULL
    )`);
    await ctx.exec('CREATE INDEX IF NOT EXISTS idx_ticket_todo_events_item ON ticket_todo_events(item_id, created_at)');
    await ctx.exec('CREATE INDEX IF NOT EXISTS idx_ticket_todo_events_ticket ON ticket_todo_events(ticket_id, created_at)');

    if (ctx.adapter === 'supabase') {
      for (const table of ['ticket_todo_items', 'ticket_todo_events']) {
        await ctx.exec(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
        await ctx.exec(`CREATE POLICY "service_role_${table}" ON ${table} FOR ALL USING (true) WITH CHECK (true)`);
      }
    }
  },

  async down(ctx) {
    await ctx.exec('DROP TABLE IF EXISTS ticket_todo_events');
    await ctx.exec('DROP TABLE IF EXISTS ticket_todo_items');
  },
};

export default migration;
