import type { Migration } from '../types.js';

/**
 * Where each pulled intake of the experimental Factory stands (behind `factoryEnabled`): an intake of a source Fleex
 * asks at an interval (Gmail, through gogcli) keeps the time its last pull covered, so the next one asks only for what
 * came since, and what went wrong with it last if anything did. It is not in the layout: the layout is what a person
 * builds, this is what the floor does with it. A row whose intake is no longer on the floor is left alone.
 */
const migration: Migration = {
  name: '050_factory_intake_pulls',

  async up(ctx) {
    const ts = ctx.adapter === 'sqlite' ? 'TEXT' : 'TIMESTAMPTZ';
    await ctx.exec(`CREATE TABLE IF NOT EXISTS factory_intake_pulls (
      intake_id TEXT PRIMARY KEY,
      floor_id TEXT NOT NULL,
      last_pulled_at ${ts},
      error TEXT,
      updated_at ${ts} NOT NULL
    )`);
    await ctx.exec('CREATE INDEX IF NOT EXISTS idx_factory_intake_pulls_floor ON factory_intake_pulls(floor_id)');
    if (ctx.adapter === 'supabase') {
      await ctx.exec('ALTER TABLE factory_intake_pulls ENABLE ROW LEVEL SECURITY');
      await ctx.exec(`CREATE POLICY "service_role_factory_intake_pulls" ON factory_intake_pulls FOR ALL USING (true) WITH CHECK (true)`);
    }
  },

  async down(ctx) {
    await ctx.exec('DROP TABLE IF EXISTS factory_intake_pulls');
  },
};

export default migration;
