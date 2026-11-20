import type { Migration } from '../types.js';

/**
 * A station's visits to an item (experimental Factory, behind `factoryEnabled`). `factory_runs` belongs to tickets
 * (its `ticket_id` is a foreign key to `tickets`), and an item is not a ticket: its visits are kept here, with what
 * the station answered, since an item has no thread to post it in.
 *
 * - `reply`: what the agent wrote (the comment it would have posted on a ticket), in markdown.
 * - `deliverable_id`: the deliverable it produced, if any (a deliverable with no ticket, shown in Docs).
 * Deleting an item's row deletes its visits (FK cascade); items are soft deleted, so that only happens by hand.
 */
const migration: Migration = {
  name: '047_factory_item_runs',

  async up(ctx) {
    const ts = ctx.adapter === 'sqlite' ? 'TEXT' : 'TIMESTAMPTZ';
    await ctx.exec(`CREATE TABLE IF NOT EXISTS factory_item_runs (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL REFERENCES factory_items(id) ON DELETE CASCADE,
      floor_id TEXT NOT NULL,
      machine_id TEXT NOT NULL,
      machine_name TEXT NOT NULL,
      executor TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'needs_review', 'question', 'interrupted')),
      outcome TEXT,
      execution_id TEXT,
      error TEXT,
      reply TEXT,
      deliverable_id TEXT,
      started_at ${ts} NOT NULL,
      finished_at ${ts}
    )`);
    await ctx.exec('CREATE INDEX IF NOT EXISTS idx_factory_item_runs_item ON factory_item_runs(item_id, started_at)');
    if (ctx.adapter === 'supabase') {
      await ctx.exec('ALTER TABLE factory_item_runs ENABLE ROW LEVEL SECURITY');
      await ctx.exec(`CREATE POLICY "service_role_factory_item_runs" ON factory_item_runs FOR ALL USING (true) WITH CHECK (true)`);
    }
  },

  async down(ctx) {
    await ctx.exec('DROP TABLE IF EXISTS factory_item_runs');
  },
};

export default migration;
