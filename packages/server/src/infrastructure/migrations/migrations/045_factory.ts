import type { Migration } from '../types.js';

/**
 * The Factory (experimental, behind `factoryEnabled`): a floor of machines that
 * tickets travel through. Everything it needs lives in these three tables, so
 * the feature can be switched off, or removed with `down()`, without touching
 * any existing table.
 *
 * - `factory_floors`: one row per floor; `layout` is the machines (belts, arms,
 *   stations, zones, exits) and `settings` the safety limits.
 * - `factory_tickets`: one row per ticket handed over to the Factory. The row
 *   IS the "transferred" flag: no column is added to `tickets`. `state` is where
 *   the ticket stands on the floor.
 * - `factory_runs`: one row per visit of a ticket to a station (the agent
 *   execution it started, the outcome it left with).
 * Deleting a ticket deletes its Factory rows (FK cascade).
 */
const migration: Migration = {
  name: '045_factory',

  async up(ctx) {
    const ts = ctx.adapter === 'sqlite' ? 'TEXT' : 'TIMESTAMPTZ';
    const json = ctx.adapter === 'sqlite' ? 'TEXT' : 'JSONB';

    await ctx.exec(`CREATE TABLE IF NOT EXISTS factory_floors (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      layout ${json} NOT NULL,
      settings ${json} NOT NULL,
      created_at ${ts} NOT NULL,
      updated_at ${ts} NOT NULL
    )`);

    await ctx.exec(`CREATE TABLE IF NOT EXISTS factory_tickets (
      ticket_id TEXT PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE,
      floor_id TEXT NOT NULL REFERENCES factory_floors(id) ON DELETE CASCADE,
      machine_id TEXT,
      state ${json} NOT NULL,
      created_at ${ts} NOT NULL,
      updated_at ${ts} NOT NULL
    )`);
    await ctx.exec('CREATE INDEX IF NOT EXISTS idx_factory_tickets_floor ON factory_tickets(floor_id)');

    await ctx.exec(`CREATE TABLE IF NOT EXISTS factory_runs (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      floor_id TEXT NOT NULL,
      machine_id TEXT NOT NULL,
      machine_name TEXT NOT NULL,
      executor TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'needs_review', 'question', 'interrupted')),
      outcome TEXT,
      execution_id TEXT,
      error TEXT,
      started_at ${ts} NOT NULL,
      finished_at ${ts}
    )`);
    await ctx.exec('CREATE INDEX IF NOT EXISTS idx_factory_runs_ticket ON factory_runs(ticket_id, started_at)');
    await ctx.exec('CREATE INDEX IF NOT EXISTS idx_factory_runs_floor ON factory_runs(floor_id, started_at)');

    if (ctx.adapter === 'supabase') {
      for (const table of ['factory_floors', 'factory_tickets', 'factory_runs']) {
        await ctx.exec(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
        await ctx.exec(`CREATE POLICY "service_role_${table}" ON ${table} FOR ALL USING (true) WITH CHECK (true)`);
      }
    }
  },

  async down(ctx) {
    await ctx.exec('DROP TABLE IF EXISTS factory_runs');
    await ctx.exec('DROP TABLE IF EXISTS factory_tickets');
    await ctx.exec('DROP TABLE IF EXISTS factory_floors');
  },
};

export default migration;
