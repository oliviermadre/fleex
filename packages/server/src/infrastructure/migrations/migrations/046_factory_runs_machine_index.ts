import type { Migration } from '../types.js';

/**
 * The runs of one machine, newest first: what a machine's popup asks for every few seconds. Until now the route
 * read the floor's last 2000 runs and kept that machine's in JS.
 */
const migration: Migration = {
  name: '046_factory_runs_machine_index',

  async up(ctx) {
    await ctx.exec('CREATE INDEX IF NOT EXISTS idx_factory_runs_machine ON factory_runs(floor_id, machine_id, started_at)');
  },

  async down(ctx) {
    await ctx.exec('DROP INDEX IF EXISTS idx_factory_runs_machine');
  },
};

export default migration;
