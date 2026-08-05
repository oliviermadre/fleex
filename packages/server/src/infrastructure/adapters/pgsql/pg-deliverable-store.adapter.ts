import type { DeliverableType, DeliverableStatus } from '@fleex/shared';
import { TicketDeliverableEntity } from '../../../domain/entities/ticket-deliverable.entity.js';
import type {
  DeliverableStorePort,
  DeliverableFacetCounts,
  DeliverableQueryFilters,
  DeliverableQueryOptions,
  DeliverableQueryResult,
} from '../../../application/ports/deliverable-store.port.js';
import type { PgConnection } from './connection.js';
import {
  DELIVERABLE_SEARCH_VIEW,
  likePattern,
  originFromRow,
  type DeliverableOriginColumns,
} from '../deliverable-search.js';

/** Facet dimension excluded from its own filter, so a facet list stays browsable. */
type FacetDimension = 'type' | 'emitter' | 'status' | 'origin_kind';

/**
 * Build the shared WHERE clause. `except` drops one dimension's own filter so a
 * facet list keeps showing its siblings once the user selects a value in it.
 */
function buildWhere(
  filters: DeliverableQueryFilters,
  except?: FacetDimension,
): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const add = (column: FacetDimension, values: string[] | undefined) => {
    if (!values?.length || except === column) return;
    params.push(values);
    clauses.push(`${column} = ANY($${params.length}::text[])`);
  };
  add('type', filters.types);
  add('emitter', filters.agentNames);
  add('status', filters.statuses);
  add('origin_kind', filters.originKinds);
  if (filters.ticketId) {
    params.push(filters.ticketId);
    clauses.push(`ticket_id = $${params.length}`);
  }
  if (filters.search?.trim()) {
    // Deliverable title, ticket title, or routine name — the three names a
    // reader might remember a document by.
    params.push(likePattern(filters.search));
    const p = `$${params.length}`;
    clauses.push(
      `(LOWER(title) LIKE ${p} OR LOWER(COALESCE(ticket_title, '')) LIKE ${p}
        OR LOWER(COALESCE(origin_routine_name, '')) LIKE ${p})`,
    );
  }
  return { sql: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

export class PgDeliverableStore implements DeliverableStorePort {
  constructor(private readonly db: PgConnection) {}

  async getByTicket(ticketId: string): Promise<TicketDeliverableEntity[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM deliverables WHERE ticket_id = $1 ORDER BY created_at ASC',
      [ticketId],
    );
    return rows.map(rowToDeliverable);
  }

  async getByTicketIds(ticketIds: string[]): Promise<TicketDeliverableEntity[]> {
    if (ticketIds.length === 0) return [];
    const { rows } = await this.db.query(
      'SELECT * FROM deliverables WHERE ticket_id = ANY($1::text[]) ORDER BY created_at ASC',
      [ticketIds],
    );
    return rows.map(rowToDeliverable);
  }

  async getById(id: string): Promise<TicketDeliverableEntity | null> {
    const { rows } = await this.db.query('SELECT * FROM deliverables WHERE id = $1', [id]);
    return rows.length > 0 ? rowToDeliverable(rows[0]) : null;
  }

  async getAll(): Promise<TicketDeliverableEntity[]> {
    const { rows } = await this.db.query('SELECT * FROM deliverables ORDER BY created_at ASC');
    return rows.map(rowToDeliverable);
  }

  async query(options: DeliverableQueryOptions): Promise<DeliverableQueryResult> {
    const { sql: where, params } = buildWhere(options);
    const countRes = await this.db.query(
      `SELECT COUNT(*)::int AS count FROM ${DELIVERABLE_SEARCH_VIEW} ${where}`,
      params,
    );
    const { rows } = await this.db.query(
      `SELECT * FROM ${DELIVERABLE_SEARCH_VIEW} ${where} ORDER BY updated_at DESC, id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, options.limit, options.offset],
    );

    const origins: DeliverableQueryResult['origins'] = {};
    for (const row of rows) {
      const origin = originFromRow(row as unknown as DeliverableOriginColumns);
      if (origin) origins[row.id as string] = origin;
    }
    return {
      items: rows.map(rowToDeliverable),
      total: (countRes.rows[0]?.count as number) ?? 0,
      origins,
    };
  }

  async getFacets(filters: DeliverableQueryFilters = {}): Promise<DeliverableFacetCounts> {
    const facet = async (column: FacetDimension) => {
      const { sql: where, params } = buildWhere(filters, column);
      const { rows } = await this.db.query(
        `SELECT ${column} AS value, COUNT(*)::int AS count FROM ${DELIVERABLE_SEARCH_VIEW} ${where}
         GROUP BY ${column} ORDER BY count DESC`,
        params,
      );
      return rows.map((r) => ({ value: String(r.value), count: r.count as number }));
    };
    const { sql: where, params } = buildWhere(filters);
    const countRes = await this.db.query(
      `SELECT COUNT(*)::int AS count FROM ${DELIVERABLE_SEARCH_VIEW} ${where}`,
      params,
    );
    const [types, agentNames, statuses, originKinds] = await Promise.all([
      facet('type'),
      facet('emitter'),
      facet('status'),
      facet('origin_kind'),
    ]);
    return {
      types,
      agentNames,
      statuses,
      originKinds,
      total: (countRes.rows[0]?.count as number) ?? 0,
    };
  }

  async getByWorkflowRun(workflowRunId: string): Promise<TicketDeliverableEntity[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM deliverables WHERE workflow_run_id = $1 ORDER BY created_at ASC',
      [workflowRunId],
    );
    return rows.map(rowToDeliverable);
  }

  async getByStepRun(stepRunId: string): Promise<TicketDeliverableEntity[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM deliverables WHERE step_run_id = $1 ORDER BY created_at ASC',
      [stepRunId],
    );
    return rows.map(rowToDeliverable);
  }

  async getByTicketAndType(ticketId: string, type: string): Promise<TicketDeliverableEntity | null> {
    const { rows } = await this.db.query(
      'SELECT * FROM deliverables WHERE ticket_id = $1 AND type = $2 LIMIT 1',
      [ticketId, type],
    );
    return rows.length > 0 ? rowToDeliverable(rows[0]) : null;
  }

  async getAllByType(type: string): Promise<TicketDeliverableEntity[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM deliverables WHERE type = $1 ORDER BY created_at ASC',
      [type],
    );
    return rows.map(rowToDeliverable);
  }

  async save(deliverable: TicketDeliverableEntity): Promise<void> {
    await this.db.query(
      `INSERT INTO deliverables (
        id, ticket_id, agent_name, type, title, content,
        version, status, mention_id, created_at, updated_at, workflow_run_id, step_run_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT (id) DO UPDATE SET
        ticket_id = $2,
        agent_name = $3,
        type = $4,
        title = $5,
        content = $6,
        version = $7,
        status = $8,
        mention_id = $9,
        created_at = $10,
        updated_at = $11,
        workflow_run_id = $12,
        step_run_id = $13`,
      [
        deliverable.id,
        deliverable.ticketId,
        deliverable.agentName,
        deliverable.type,
        deliverable.title,
        deliverable.content,
        deliverable.version,
        deliverable.status,
        deliverable.mentionId,
        deliverable.createdAt.toISOString(),
        deliverable.updatedAt.toISOString(),
        deliverable.workflowRunId,
        deliverable.stepRunId,
      ],
    );
  }

  async remove(id: string): Promise<void> {
    await this.db.query('DELETE FROM deliverables WHERE id = $1', [id]);
  }
}

function rowToDeliverable(row: Record<string, unknown>): TicketDeliverableEntity {
  return new TicketDeliverableEntity(
    row.id as string,
    (row.ticket_id as string) ?? null,
    row.agent_name as string,
    row.type as DeliverableType,
    row.title as string,
    row.content as string,
    (row.version as number) ?? 1,
    (row.status as DeliverableStatus) ?? 'draft',
    (row.mention_id as string) ?? null,
    new Date(row.created_at as string),
    new Date(row.updated_at as string),
    (row.workflow_run_id as string) ?? null,
    (row.step_run_id as string) ?? null,
  );
}
