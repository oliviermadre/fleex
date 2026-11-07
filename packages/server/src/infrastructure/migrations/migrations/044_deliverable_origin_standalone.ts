import type { Migration } from '../types.js';

/**
 * `origin_kind = 'standalone'` — a document the user wrote by hand, with no
 * ticket and no run behind it (Docs "+ New document", Agenda "+ New
 * deliverable…"). Until now it fell into 'none' with the documents whose
 * ticket was deleted, so the sidebar could not find it again.
 *
 * Only the CASE changes; everything else is migration 031's view verbatim.
 */
const VIEW_SQL = (emitter: string) => `
  SELECT
    d.*,
    ${emitter} AS emitter,
    CASE
      WHEN t.id IS NOT NULL THEN 'ticket'
      WHEN r.id IS NOT NULL THEN 'routine'
      WHEN d.ticket_id IS NULL AND d.workflow_run_id IS NULL AND d.step_run_id IS NULL THEN 'standalone'
      ELSE 'none'
    END AS origin_kind,
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
  name: '044_deliverable_origin_standalone',

  async up(ctx) {
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
