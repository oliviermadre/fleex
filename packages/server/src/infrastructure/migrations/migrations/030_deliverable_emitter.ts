import type { Migration } from '../types.js';

/**
 * Collapse a workflow's steps into the workflow itself.
 *
 * A step writes its deliverables as `workflow:<template> → <step>`, so the
 * Documents sidebar listed one facet per step: a dozen "workflow:Spec Dev PR
 * (…)" entries where the reader only ever wanted "Spec Dev PR". `emitter` is
 * that agent name with the step suffix removed — the granularity this view
 * needs — and it is computed in SQL so the facet counts add up server-side
 * instead of being re-grouped over a single page.
 *
 * Replaces (not alters) the view created by migration 029.
 */
const VIEW_SQL = (emitter: string) => `
  SELECT
    d.*,
    ${emitter} AS emitter,
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

/** The step separator written by run-workflow-step (U+2192, space-padded). */
const SEP = ' → ';

const migration: Migration = {
  name: '030_deliverable_emitter',

  async up(ctx) {
    // SQLite has no split_part; both expressions return the whole string when
    // the separator is absent (a persona or panel name passes through).
    const emitter = ctx.dialect({
      sqlite: `CASE WHEN instr(d.agent_name, '${SEP}') > 0
                 THEN substr(d.agent_name, 1, instr(d.agent_name, '${SEP}') - 1)
                 ELSE d.agent_name END`,
      pgsql: `split_part(d.agent_name, '${SEP}', 1)`,
      supabase: `split_part(d.agent_name, '${SEP}', 1)`,
    })!;

    await ctx.exec('DROP VIEW IF EXISTS deliverables_search');
    await ctx.exec(`CREATE VIEW deliverables_search AS ${VIEW_SQL(emitter)}`);

    if (ctx.adapter === 'supabase') {
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
