import type { DeliverableType, DeliverableStatus } from '@fleex/shared';
import { TicketDeliverableEntity } from '../../../domain/entities/ticket-deliverable.entity.js';
import type {
  DeliverableStorePort,
  DeliverableFacetCounts,
  DeliverableQueryFilters,
  DeliverableQueryOptions,
  DeliverableQueryResult,
} from '../../../application/ports/deliverable-store.port.js';
import type { SupabaseConnection } from './connection.js';
import { chunkIds } from './supabase-chunk.js';
import {
  DELIVERABLE_SEARCH_VIEW,
  EMITTER_COLUMN,
  originFromRow,
  postgrestSearchTerm,
  type DeliverableOriginColumns,
} from '../deliverable-search.js';

/** PostgREST's max-rows cap (Supabase default) — the page size we paginate on. */
const PAGE = 1000;

interface DeliverableRow {
  id: string;
  ticket_id: string | null;
  workflow_run_id: string | null;
  step_run_id: string | null;
  agent_name: string;
  type: DeliverableType;
  title: string;
  content: string;
  version: number;
  status: DeliverableStatus;
  mention_id: string | null;
  created_at: string;
  updated_at: string;
}

function rowToEntity(r: DeliverableRow): TicketDeliverableEntity {
  return new TicketDeliverableEntity(
    r.id,
    r.ticket_id,
    r.agent_name,
    r.type,
    r.title,
    r.content,
    r.version,
    r.status,
    r.mention_id,
    new Date(r.created_at),
    new Date(r.updated_at),
    r.workflow_run_id ?? null,
    r.step_run_id ?? null,
  );
}

export class SupabaseDeliverableStore implements DeliverableStorePort {
  constructor(private readonly conn: SupabaseConnection) {}

  async getByTicket(ticketId: string): Promise<TicketDeliverableEntity[]> {
    const { data, error } = await this.conn.client
      .from('deliverables')
      .select('*')
      .eq('ticket_id', ticketId);
    if (error) throw new Error(`SupabaseDeliverableStore.getByTicket failed: ${error.message}`);
    return (data as DeliverableRow[]).map(rowToEntity);
  }

  async getByTicketIds(ticketIds: string[]): Promise<TicketDeliverableEntity[]> {
    if (ticketIds.length === 0) return [];
    // PostgREST silently caps responses at max-rows (Supabase default: 1000).
    // Bulk callers (unread-counts for the cockpit view) can match far more, so
    // paginate explicitly — otherwise counts silently truncate (bug #400).
    // Ordering (created_at, id) is required for stable, non-overlapping pages.
    // `.in()` lands in the query string, which Supabase's proxy caps at ~8 KB —
    // so the ID list is chunked before paginating each chunk (#509).
    const PAGE = 1000;
    const rows: DeliverableRow[] = [];
    for (const chunk of chunkIds(ticketIds)) {
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await this.conn.client
          .from('deliverables')
          .select('*')
          .in('ticket_id', chunk)
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) throw new Error(`SupabaseDeliverableStore.getByTicketIds failed: ${error.message}`);
        const page = data as DeliverableRow[];
        rows.push(...page);
        if (page.length < PAGE) break;
      }
    }
    return rows.map(rowToEntity);
  }

  async getById(id: string): Promise<TicketDeliverableEntity | null> {
    const { data, error } = await this.conn.client
      .from('deliverables')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`SupabaseDeliverableStore.getById failed: ${error.message}`);
    return data ? rowToEntity(data as DeliverableRow) : null;
  }

  async getAll(): Promise<TicketDeliverableEntity[]> {
    // Paginated for the same reason as getByTicketIds: an unpaginated select is
    // silently truncated at max-rows, and here that cost the Documents view its
    // most recent documents (the cap kept the *oldest* 1000 rows).
    const rows: DeliverableRow[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await this.conn.client
        .from('deliverables')
        .select('*')
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`SupabaseDeliverableStore.getAll failed: ${error.message}`);
      const page = data as DeliverableRow[];
      rows.push(...page);
      if (page.length < PAGE) break;
    }
    return rows.map(rowToEntity);
  }

  /**
   * The Documents view reads the `deliverables_search` view (migration 029) so
   * PostgREST — which cannot join — still sees the origin columns and can match
   * on ticket title / routine name. A workspace whose schema was applied
   * externally may not have it yet, so the first miss falls back to the base
   * table (search then matches deliverable titles only) instead of 500ing.
   */
  private searchRelation: string = DELIVERABLE_SEARCH_VIEW;

  private demoteIfViewMissing(error: { code?: string; message?: string }): boolean {
    const missing =
      error.code === 'PGRST205' ||
      /could not find the table|does not exist/i.test(error.message ?? '');
    if (missing && this.searchRelation === DELIVERABLE_SEARCH_VIEW) {
      this.searchRelation = 'deliverables';
      return true;
    }
    return false;
  }

  /**
   * The "agentic" dimension groups on `emitter` (workflow steps collapsed into
   * their workflow); only the view has it, so the fallback degrades to the raw
   * agent name.
   */
  private get emitterColumn(): string {
    return this.searchRelation === DELIVERABLE_SEARCH_VIEW ? EMITTER_COLUMN : 'agent_name';
  }

  /** `or(...)` over the name columns the current relation actually exposes. */
  private searchExpression(search: string): string | null {
    const term = postgrestSearchTerm(search);
    if (!term) return null;
    const columns =
      this.searchRelation === DELIVERABLE_SEARCH_VIEW
        ? ['title', 'ticket_title', 'origin_routine_name']
        : ['title'];
    return columns.map((c) => `${c}.ilike.*${term}*`).join(',');
  }

  async query(options: DeliverableQueryOptions): Promise<DeliverableQueryResult> {
    const run = async () => {
      let q = this.conn.client.from(this.searchRelation).select('*', { count: 'exact' });
      if (options.types?.length) q = q.in('type', options.types);
      if (options.agentNames?.length) q = q.in(this.emitterColumn, options.agentNames);
      if (options.statuses?.length) q = q.in('status', options.statuses);
      if (options.originKinds?.length && this.searchRelation === DELIVERABLE_SEARCH_VIEW) {
        q = q.in('origin_kind', options.originKinds);
      }
      if (options.ticketId) q = q.eq('ticket_id', options.ticketId);
      if (options.search) {
        const expr = this.searchExpression(options.search);
        if (expr) q = q.or(expr);
      }
      return q
        .order('updated_at', { ascending: false })
        .order('id', { ascending: false })
        .range(options.offset, options.offset + options.limit - 1);
    };

    let { data, error, count } = await run();
    if (error && this.demoteIfViewMissing(error)) ({ data, error, count } = await run());
    if (error) throw new Error(`SupabaseDeliverableStore.query failed: ${error.message}`);

    const rows = data as (DeliverableRow & Partial<DeliverableOriginColumns>)[];
    const origins: DeliverableQueryResult['origins'] = {};
    for (const row of rows) {
      const origin = originFromRow(row);
      if (origin) origins[row.id] = origin;
    }
    return { items: rows.map(rowToEntity), total: count ?? 0, origins };
  }

  async getFacets(filters: DeliverableQueryFilters = {}): Promise<DeliverableFacetCounts> {
    // PostgREST has no GROUP BY, so scan the three facet columns (small rows,
    // no content) and aggregate here. Each dimension ignores its own filter so
    // its list stays browsable once a value is selected.
    // `emitter` on the view, `agent_name` on the fallback — normalised below so
    // the tally is written once.
    // `origin_kind` exists only on the view; the fallback leaves it undefined
    // and the dimension simply comes back empty.
    type FacetRow = {
      type: string;
      emitter?: string;
      agent_name?: string;
      status: string;
      origin_kind?: string;
    };
    const rows: FacetRow[] = [];
    for (let from = 0; ; from += PAGE) {
      const run = async () => {
        let q = this.conn.client
          .from(this.searchRelation)
          .select(
            this.searchRelation === DELIVERABLE_SEARCH_VIEW
              ? `type,${EMITTER_COLUMN},status,origin_kind`
              : 'type,agent_name,status',
          );
        if (filters.ticketId) q = q.eq('ticket_id', filters.ticketId);
        if (filters.search) {
          const expr = this.searchExpression(filters.search);
          if (expr) q = q.or(expr);
        }
        return q.order('id', { ascending: true }).range(from, from + PAGE - 1);
      };
      let { data, error } = await run();
      if (error && this.demoteIfViewMissing(error)) ({ data, error } = await run());
      if (error) throw new Error(`SupabaseDeliverableStore.getFacets failed: ${error.message}`);
      // The selected columns are built at runtime (view vs fallback), which
      // defeats supabase-js's literal-type parsing of the select string.
      const page = data as unknown as FacetRow[];
      rows.push(...page);
      if (page.length < PAGE) break;
    }

    type Dimension = 'type' | 'emitter' | 'status' | 'origin_kind';
    const valueOf = (r: FacetRow, dimension: Dimension): string =>
      dimension === 'emitter' ? r.emitter ?? r.agent_name ?? '' : r[dimension] ?? '';

    const matches = (r: FacetRow, except?: Dimension) =>
      (except === 'type' || !filters.types?.length || filters.types.includes(r.type)) &&
      (except === 'emitter' || !filters.agentNames?.length || filters.agentNames.includes(valueOf(r, 'emitter'))) &&
      (except === 'status' || !filters.statuses?.length || filters.statuses.includes(r.status)) &&
      (except === 'origin_kind' || !filters.originKinds?.length || filters.originKinds.includes(valueOf(r, 'origin_kind')));

    const tally = (dimension: Dimension) => {
      const counts = new Map<string, number>();
      for (const r of rows) {
        if (!matches(r, dimension)) continue;
        const value = valueOf(r, dimension);
        if (!value) continue; // dimension absent on the fallback relation
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
      return Array.from(counts, ([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
    };

    return {
      types: tally('type'),
      agentNames: tally('emitter'),
      statuses: tally('status'),
      originKinds: tally('origin_kind'),
      total: rows.filter((r) => matches(r)).length,
    };
  }

  async getByWorkflowRun(workflowRunId: string): Promise<TicketDeliverableEntity[]> {
    const { data, error } = await this.conn.client
      .from('deliverables')
      .select('*')
      .eq('workflow_run_id', workflowRunId)
      .order('created_at');
    if (error) throw new Error(`SupabaseDeliverableStore.getByWorkflowRun failed: ${error.message}`);
    return (data as DeliverableRow[]).map(rowToEntity);
  }

  async getByStepRun(stepRunId: string): Promise<TicketDeliverableEntity[]> {
    const { data, error } = await this.conn.client
      .from('deliverables')
      .select('*')
      .eq('step_run_id', stepRunId)
      .order('created_at');
    if (error) throw new Error(`SupabaseDeliverableStore.getByStepRun failed: ${error.message}`);
    return (data as DeliverableRow[]).map(rowToEntity);
  }

  async getByTicketAndType(ticketId: string, type: string): Promise<TicketDeliverableEntity | null> {
    const { data, error } = await this.conn.client
      .from('deliverables')
      .select('*')
      .eq('ticket_id', ticketId)
      .eq('type', type)
      .maybeSingle();
    if (error) throw new Error(`SupabaseDeliverableStore.getByTicketAndType failed: ${error.message}`);
    return data ? rowToEntity(data as DeliverableRow) : null;
  }

  async getAllByType(type: string): Promise<TicketDeliverableEntity[]> {
    // Paginated: a popular type can exceed max-rows on its own.
    const rows: DeliverableRow[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await this.conn.client
        .from('deliverables')
        .select('*')
        .eq('type', type)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`SupabaseDeliverableStore.getAllByType failed: ${error.message}`);
      const page = data as DeliverableRow[];
      rows.push(...page);
      if (page.length < PAGE) break;
    }
    return rows.map(rowToEntity);
  }

  async save(deliverable: TicketDeliverableEntity): Promise<void> {
    const { error } = await this.conn.client.from('deliverables').upsert({
      id: deliverable.id,
      ticket_id: deliverable.ticketId,
      workflow_run_id: deliverable.workflowRunId,
      step_run_id: deliverable.stepRunId,
      agent_name: deliverable.agentName,
      type: deliverable.type,
      title: deliverable.title,
      content: deliverable.content,
      version: deliverable.version,
      status: deliverable.status,
      mention_id: deliverable.mentionId,
      created_at: deliverable.createdAt.toISOString(),
      updated_at: deliverable.updatedAt.toISOString(),
    });
    if (error) throw new Error(`SupabaseDeliverableStore.save failed: ${error.message}`);
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.conn.client
      .from('deliverables')
      .delete()
      .eq('id', id);
    if (error) throw new Error(`SupabaseDeliverableStore.remove failed: ${error.message}`);
  }
}
