import type { Migration } from '../types.js';

/**
 * Migrate old 14-type system to new 6-type system:
 *   feat, refactor, perf, test, ci, chore → build
 *   fix → fix (unchanged)
 *   review → review (unchanged)
 *   ops → ops (unchanged)
 *   doc, research, design, data → think
 *   task → build
 */
const OLD_TO_NEW: Record<string, string> = {
  feat: 'build',
  refactor: 'build',
  perf: 'build',
  test: 'build',
  ci: 'build',
  chore: 'build',
  task: 'build',
  fix: 'fix',
  review: 'review',
  ops: 'ops',
  doc: 'think',
  research: 'think',
  design: 'think',
  data: 'think',
};

const migration: Migration = {
  name: '015_migrate_ticket_types',

  async up(ctx) {
    if (ctx.adapter === 'json') return;

    for (const [oldType, newType] of Object.entries(OLD_TO_NEW)) {
      if (oldType === newType) continue;
      await ctx.exec(`UPDATE tickets SET type = '${newType}' WHERE type = '${oldType}'`);
    }
  },

  async down(_ctx) {
    // Non-reversible: old type information is lost after mapping
  },
};

export default migration;
