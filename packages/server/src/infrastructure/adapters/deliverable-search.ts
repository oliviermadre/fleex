import type { DeliverableOriginRef } from '../../application/ports/deliverable-store.port.js';

/**
 * The relation every adapter reads for the Documents view: `deliverables` plus
 * its origin (ticket title / routine name), joined once in SQL — see migration
 * 029. Filtering and searching happen here so PostgREST, which cannot join,
 * gets the same shape as the SQL adapters.
 */
export const DELIVERABLE_SEARCH_VIEW = 'deliverables_search';

/**
 * The column the "agentic" dimension groups on. `agent_name` carries the step
 * that produced a deliverable (`workflow:Spec Dev PR → Check Spec`); `emitter`
 * is the same value with the step dropped, which is the granularity the
 * Documents view wants. See migration 030.
 */
export const EMITTER_COLUMN = 'emitter';

/** Columns the view adds on top of a `deliverables` row. */
export interface DeliverableOriginColumns {
  ticket_id: string | null;
  ticket_title: string | null;
  origin_run_id: string | null;
  origin_routine_id: string | null;
  origin_routine_name: string | null;
}

/**
 * A deliverable belongs to a ticket *or* to a routine run. Rows whose ticket
 * was deleted (or whose run has no routine) have no origin to show.
 */
export function originFromRow(row: Partial<DeliverableOriginColumns>): DeliverableOriginRef | null {
  if (row.ticket_id && row.ticket_title) {
    return { kind: 'ticket', id: row.ticket_id, label: row.ticket_title };
  }
  if (row.origin_routine_id && row.origin_routine_name) {
    return {
      kind: 'routine',
      id: row.origin_routine_id,
      label: row.origin_routine_name,
      workflowRunId: row.origin_run_id ?? null,
    };
  }
  return null;
}

/** `%term%`, lowercased — the pattern used by the SQL adapters' LIKE/ILIKE. */
export function likePattern(search: string): string {
  const escaped = search.trim().toLowerCase().replace(/[%_\\]/g, (c) => `\\${c}`);
  return `%${escaped}%`;
}

/**
 * PostgREST reads its filters from the query string, where `,` `.` `(` `)` and
 * `*` are syntax. Strip them rather than escape: a search box loses nothing by
 * treating them as separators, and a stray one would otherwise corrupt the
 * whole `or(...)` expression.
 */
export function postgrestSearchTerm(search: string): string {
  return search.trim().replace(/[,.()*\\"']/g, ' ').trim();
}
