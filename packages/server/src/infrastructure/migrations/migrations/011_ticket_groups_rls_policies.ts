import type { Migration } from '../types.js';

const migration: Migration = {
  name: '011_ticket_groups_rls_policies',

  async up(ctx) {
    if (ctx.adapter !== 'supabase') return;

    const tables = ['ticket_groups', 'ticket_group_memberships', 'ticket_relationships'];

    for (const table of tables) {
      await ctx.exec(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      await ctx.exec(
        `CREATE POLICY "service_role_${table}" ON ${table} FOR ALL USING (true) WITH CHECK (true)`,
      );
    }
  },

  async down(ctx) {
    if (ctx.adapter !== 'supabase') return;

    const tables = ['ticket_groups', 'ticket_group_memberships', 'ticket_relationships'];

    for (const table of tables) {
      try {
        await ctx.exec(`DROP POLICY IF EXISTS "service_role_${table}" ON ${table}`);
        await ctx.exec(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`);
      } catch {
        // Policy may not exist
      }
    }
  },
};

export default migration;
