import type { DeliverableType, DeliverableStatus } from '@fleex/shared';
import { TicketDeliverableEntity } from '../../../domain/entities/ticket-deliverable.entity.js';
import type {
  DeliverableStorePort,
  DeliverableFacetCounts,
  DeliverableQueryFilters,
  DeliverableQueryOptions,
  DeliverableQueryResult,
} from '../../../application/ports/deliverable-store.port.js';
import type { SqliteConnection } from './connection.js';
import {
  DELIVERABLE_SEARCH_VIEW,
  likePattern,
  originFromRow,
  type DeliverableOriginColumns,
} from '../deliverable-search.js';

/** Facet dimension excluded from its own filter, so a facet list stays browsable. */
type FacetDimension = 'type' | 'emitter' | 'status' | 'origin_kind';

type SearchRow = DeliverableRow & DeliverableOriginColumns;

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
    clauses.push(`${column} IN (${values.map(() => '?').join(',')})`);
    params.push(...values);
  };
  add('type', filters.types);
  add('emitter', filters.agentNames);
  add('status', filters.statuses);
  add('origin_kind', filters.originKinds);
  if (filters.ticketId) {
    clauses.push('ticket_id = ?');
    params.push(filters.ticketId);
  }
  if (filters.search?.trim()) {
    // Deliverable title, ticket title, or routine name — the three names a
    // reader might remember a document by. ESCAPE keeps `%`/`_` literal.
    const pattern = likePattern(filters.search);
    clauses.push(
      `(LOWER(title) LIKE ? ESCAPE '\\'
        OR LOWER(COALESCE(ticket_title, '')) LIKE ? ESCAPE '\\'
        OR LOWER(COALESCE(origin_routine_name, '')) LIKE ? ESCAPE '\\')`,
    );
    params.push(pattern, pattern, pattern);
  }
  return { sql: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

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

export class SqliteDeliverableStoreAdapter implements DeliverableStorePort {
  constructor(private readonly conn: SqliteConnection) {}

  async getByTicket(ticketId: string): Promise<TicketDeliverableEntity[]> {
    const rows = this.conn.db
      .prepare('SELECT * FROM deliverables WHERE ticket_id = ? ORDER BY created_at ASC')
      .all(ticketId) as DeliverableRow[];
    return rows.map((r) => this.toEntity(r));
  }

  async getByTicketIds(ticketIds: string[]): Promise<TicketDeliverableEntity[]> {
    if (ticketIds.length === 0) return [];
    const placeholders = ticketIds.map(() => '?').join(',');
    const rows = this.conn.db
      .prepare(`SELECT * FROM deliverables WHERE ticket_id IN (${placeholders}) ORDER BY created_at ASC`)
      .all(...ticketIds) as DeliverableRow[];
    return rows.map((r) => this.toEntity(r));
  }

  async getById(id: string): Promise<TicketDeliverableEntity | null> {
    const row = this.conn.db
      .prepare('SELECT * FROM deliverables WHERE id = ?')
      .get(id) as DeliverableRow | undefined;
    return row ? this.toEntity(row) : null;
  }

  async getAll(): Promise<TicketDeliverableEntity[]> {
    const rows = this.conn.db
      .prepare('SELECT * FROM deliverables ORDER BY created_at ASC')
      .all() as DeliverableRow[];
    return rows.map((r) => this.toEntity(r));
  }

  async query(options: DeliverableQueryOptions): Promise<DeliverableQueryResult> {
    const { sql: where, params } = buildWhere(options);
    const { count } = this.conn.db
      .prepare(`SELECT COUNT(*) AS count FROM ${DELIVERABLE_SEARCH_VIEW} ${where}`)
      .get(...params) as { count: number };
    const rows = this.conn.db
      .prepare(
        `SELECT * FROM ${DELIVERABLE_SEARCH_VIEW} ${where}
         ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, options.limit, options.offset) as SearchRow[];

    const origins: DeliverableQueryResult['origins'] = {};
    for (const row of rows) {
      const origin = originFromRow(row);
      if (origin) origins[row.id] = origin;
    }
    return { items: rows.map((r) => this.toEntity(r)), total: count, origins };
  }

  async getFacets(filters: DeliverableQueryFilters = {}): Promise<DeliverableFacetCounts> {
    const facet = (column: FacetDimension) => {
      const { sql: where, params } = buildWhere(filters, column);
      return this.conn.db
        .prepare(
          `SELECT ${column} AS value, COUNT(*) AS count FROM ${DELIVERABLE_SEARCH_VIEW} ${where}
           GROUP BY ${column} ORDER BY count DESC`,
        )
        .all(...params) as { value: string; count: number }[];
    };
    const { sql: where, params } = buildWhere(filters);
    const { count } = this.conn.db
      .prepare(`SELECT COUNT(*) AS count FROM ${DELIVERABLE_SEARCH_VIEW} ${where}`)
      .get(...params) as { count: number };
    return {
      types: facet('type'),
      agentNames: facet('emitter'),
      statuses: facet('status'),
      originKinds: facet('origin_kind'),
      total: count,
    };
  }

  async getByTicketAndType(ticketId: string, type: string): Promise<TicketDeliverableEntity | null> {
    const row = this.conn.db
      .prepare('SELECT * FROM deliverables WHERE ticket_id = ? AND type = ? LIMIT 1')
      .get(ticketId, type) as DeliverableRow | undefined;
    return row ? this.toEntity(row) : null;
  }

  async getAllByType(type: string): Promise<TicketDeliverableEntity[]> {
    const rows = this.conn.db
      .prepare('SELECT * FROM deliverables WHERE type = ? ORDER BY created_at ASC')
      .all(type) as DeliverableRow[];
    return rows.map((r) => this.toEntity(r));
  }

  async save(deliverable: TicketDeliverableEntity): Promise<void> {
    const stmt = this.conn.db.prepare(`
      INSERT OR REPLACE INTO deliverables
        (id, ticket_id, workflow_run_id, step_run_id, agent_name, type, title, content, version, status,
         mention_id, created_at, updated_at)
      VALUES
        (@id, @ticket_id, @workflow_run_id, @step_run_id, @agent_name, @type, @title, @content, @version, @status,
         @mention_id, @created_at, @updated_at)
    `);

    stmt.run({
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
  }

  async remove(id: string): Promise<void> {
    this.conn.db.prepare('DELETE FROM deliverables WHERE id = ?').run(id);
  }

  private toEntity(row: DeliverableRow): TicketDeliverableEntity {
    return new TicketDeliverableEntity(
      row.id,
      row.ticket_id,
      row.agent_name,
      row.type,
      row.title,
      row.content,
      row.version,
      row.status,
      row.mention_id,
      new Date(row.created_at),
      new Date(row.updated_at),
      row.workflow_run_id ?? null,
      row.step_run_id ?? null,
    );
  }

  async getByWorkflowRun(workflowRunId: string): Promise<TicketDeliverableEntity[]> {
    const rows = this.conn.db
      .prepare('SELECT * FROM deliverables WHERE workflow_run_id = ? ORDER BY created_at ASC')
      .all(workflowRunId) as DeliverableRow[];
    return rows.map((r) => this.toEntity(r));
  }

  async getByStepRun(stepRunId: string): Promise<TicketDeliverableEntity[]> {
    const rows = this.conn.db
      .prepare('SELECT * FROM deliverables WHERE step_run_id = ? ORDER BY created_at ASC')
      .all(stepRunId) as DeliverableRow[];
    return rows.map((r) => this.toEntity(r));
  }
}
