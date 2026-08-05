import type { Migration } from '../types.js';

/**
 * A deliverable's *origin* — the ticket it was written on, or the routine whose
 * run produced it — lives two joins away from the row itself. The Documents
 * view needs it for two things the client cannot do once the list is paginated:
 * display the origin in the list, and search across deliverable title, ticket
 * title and routine name in one query.
 *
 * This view is that join, so every adapter (and PostgREST, which cannot express
 * a join) filters and orders on the same shape. Routine runs anchor either
 * directly (`workflow_run_id`) or through their step run (`step_run_id`), hence
 * the COALESCE.
 */
const VIEW_SQL = `
  SELECT
    d.*,
    t.title AS ticket_title,
    wr.id AS origin_run_id,
    wr.routine_id AS origin_routine_id,
    r.name AS origin_routine_name,
    r.emoji AS origin_routine_emoji
  FROM deliverables d
  LEFT JOIN step_runs sr ON sr.id = d.step_run_id
  LEFT JOIN workflow_runs wr ON wr.id = COALESCE(d.workflow_run_id, sr.workflow_run_id)
  LEFT JOIN routines r ON r.id = wr.routine_id
  LEFT JOIN tickets t ON t.id = d.ticket_id
`;

const migration: Migration = {
  name: '029_deliverable_search_view',

  async up(ctx) {
    // SQLite has no CREATE OR REPLACE VIEW; drop first so a re-run is idempotent.
    await ctx.exec('DROP VIEW IF EXISTS deliverables_search');
    await ctx.exec(`CREATE VIEW deliverables_search AS ${VIEW_SQL}`);

    if (ctx.adapter === 'supabase') {
      // A view inherits the RLS of its base tables (it cannot carry its own
      // policy), and `deliverables` is already service-role readable.
      // PostgREST caches the schema, so tell it about the new relation.
      await ctx.exec(`NOTIFY pgrst, 'reload schema'`);
    }
  },

  async down(ctx) {
    await ctx.exec('DROP VIEW IF EXISTS deliverables_search');
    if (ctx.adapter === 'supabase') {
      await ctx.exec(`NOTIFY pgrst, 'reload schema'`);
    }
  },
};

export default migration;
