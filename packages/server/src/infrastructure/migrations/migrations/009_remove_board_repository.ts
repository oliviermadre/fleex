import type { Migration } from '../types.js';

const migration: Migration = {
  name: '009_remove_board_repository',

  async up(ctx) {
    if (ctx.adapter === 'json') return;

    if (ctx.adapter === 'sqlite') {
      // SQLite requires separate ALTER TABLE statements
      for (const col of ['repository_org', 'repository_name']) {
        try {
          await ctx.exec(`ALTER TABLE boards DROP COLUMN ${col}`);
        } catch {
          // Column may already be gone
        }
      }
    } else {
      // pgsql / supabase
      try {
        await ctx.exec(
          'ALTER TABLE boards DROP COLUMN IF EXISTS repository_org, DROP COLUMN IF EXISTS repository_name',
        );
      } catch {
        // Columns may already be gone
      }
    }
  },

  async down(ctx) {
    if (ctx.adapter === 'json') return;

    if (ctx.adapter === 'sqlite') {
      for (const col of ['repository_org', 'repository_name']) {
        try {
          await ctx.exec(`ALTER TABLE boards ADD COLUMN ${col} TEXT`);
        } catch {
          // Column may already exist
        }
      }
    } else {
      try {
        await ctx.exec(
          'ALTER TABLE boards ADD COLUMN repository_org TEXT, ADD COLUMN repository_name TEXT',
        );
      } catch {
        // Columns may already exist
      }
    }
  },
};

export default migration;
