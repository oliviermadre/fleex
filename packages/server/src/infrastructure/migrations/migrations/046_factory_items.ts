import type { Migration } from '../types.js';

/**
 * Items of the Factory (experimental, behind `factoryEnabled`): what comes in
 * from a source (a Slack conversation, a mail thread, a GitHub pull request) and
 * may ask something of the owner. An item is NOT a ticket: it never goes in
 * `tickets`, and becomes one only when a machine on the floor makes it one.
 *
 * - One row per conversation, keyed by its source and its key in that source
 *   (`source_key`: workspace + channel + thread, mail thread id, repository +
 *   pull request number). A new message on a known key updates the row.
 * - `machine_id` and `state` are where the item stands on the floor, as
 *   `factory_tickets` has it for a ticket.
 * - Soft delete: `archived_at` and why (`junk`, `exit`, or `dropped`: what an
 *   intake's rules left out, which never reached the floor).
 * - The content is not copied: `excerpt` is a few lines to recognise it by, and
 *   `url` leads back to the source.
 */
const migration: Migration = {
  name: '046_factory_items',

  async up(ctx) {
    const ts = ctx.adapter === 'sqlite' ? 'TEXT' : 'TIMESTAMPTZ';
    const json = ctx.adapter === 'sqlite' ? 'TEXT' : 'JSONB';

    await ctx.exec(`CREATE TABLE IF NOT EXISTS factory_items (
      id TEXT PRIMARY KEY,
      floor_id TEXT NOT NULL REFERENCES factory_floors(id) ON DELETE CASCADE,
      source TEXT NOT NULL,
      source_key TEXT NOT NULL,
      title TEXT NOT NULL,
      author TEXT NOT NULL DEFAULT '',
      excerpt TEXT NOT NULL DEFAULT '',
      url TEXT,
      tags ${json} NOT NULL,
      messages INTEGER NOT NULL DEFAULT 1,
      last_activity_at ${ts} NOT NULL,
      intake_id TEXT,
      machine_id TEXT,
      state ${json},
      archived_at ${ts},
      archived_reason TEXT,
      created_at ${ts} NOT NULL,
      updated_at ${ts} NOT NULL
    )`);
    await ctx.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_factory_items_key ON factory_items(source, source_key)');
    await ctx.exec('CREATE INDEX IF NOT EXISTS idx_factory_items_floor ON factory_items(floor_id, archived_at)');

    if (ctx.adapter === 'supabase') {
      await ctx.exec('ALTER TABLE factory_items ENABLE ROW LEVEL SECURITY');
      await ctx.exec(`CREATE POLICY "service_role_factory_items" ON factory_items FOR ALL USING (true) WITH CHECK (true)`);
    }
  },

  async down(ctx) {
    await ctx.exec('DROP TABLE IF EXISTS factory_items');
  },
};

export default migration;
