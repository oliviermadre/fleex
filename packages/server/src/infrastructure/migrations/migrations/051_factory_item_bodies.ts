import type { Migration } from '../types.js';

/**
 * The whole of an item's latest message (experimental Factory, behind `factoryEnabled`): its text and, for a mail, its
 * HTML part as sent. Apart from `factory_items`, whose row is written each time the item moves on the floor: a body is
 * written once, when its message comes in, and read only when the item is opened or a station runs on it.
 * Deleting an item's row deletes its body (FK cascade); items are soft deleted, so that only happens by hand.
 */
const migration: Migration = {
  name: '051_factory_item_bodies',

  async up(ctx) {
    const ts = ctx.adapter === 'sqlite' ? 'TEXT' : 'TIMESTAMPTZ';
    await ctx.exec(`CREATE TABLE IF NOT EXISTS factory_item_bodies (
      item_id TEXT PRIMARY KEY REFERENCES factory_items(id) ON DELETE CASCADE,
      text TEXT NOT NULL DEFAULT '',
      html TEXT,
      updated_at ${ts} NOT NULL
    )`);
    if (ctx.adapter === 'supabase') {
      await ctx.exec('ALTER TABLE factory_item_bodies ENABLE ROW LEVEL SECURITY');
      await ctx.exec(`CREATE POLICY "service_role_factory_item_bodies" ON factory_item_bodies FOR ALL USING (true) WITH CHECK (true)`);
    }
  },

  async down(ctx) {
    await ctx.exec('DROP TABLE IF EXISTS factory_item_bodies');
  },
};

export default migration;
