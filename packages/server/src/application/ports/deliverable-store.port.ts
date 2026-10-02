import type { TicketDeliverableEntity } from '../../domain/entities/ticket-deliverable.entity.js';

/** Filters shared by the paged query and the facet aggregation. */
export interface DeliverableQueryFilters {
  types?: string[];
  agentNames?: string[];
  statuses?: string[];
  ticketId?: string;
  /** 'ticket' | 'routine' | 'none' — where the deliverable hangs off. */
  originKinds?: string[];
  /**
   * Free-text match on the deliverable title, its ticket's title, or the name
   * of the routine whose run produced it.
   */
  search?: string;
}

/**
 * Where a deliverable came from: the ticket it was written on, or the routine
 * whose run produced it. Resolved in SQL (see the `deliverables_search` view)
 * because the client only ever holds one page.
 */
export interface DeliverableOriginRef {
  kind: 'ticket' | 'routine';
  id: string;
  label: string;
  /** Set for routine origins — the run that emitted the deliverable. */
  workflowRunId?: string | null;
}

export interface DeliverableQueryOptions extends DeliverableQueryFilters {
  limit: number;
  offset: number;
}

export interface DeliverableQueryResult {
  items: TicketDeliverableEntity[];
  /** Rows matching the filters in the database — not `items.length`. */
  total: number;
  /** Origin per deliverable id, for the items of this page only. */
  origins: Record<string, DeliverableOriginRef>;
}

export interface DeliverableFacetCounts {
  types: { value: string; count: number }[];
  agentNames: { value: string; count: number }[];
  statuses: { value: string; count: number }[];
  /** Ticket vs routine — the origin dimension of the sidebar. */
  originKinds: { value: string; count: number }[];
  total: number;
}

/** A deliverable reduced to what counting needs — no title, no `content`. */
export interface DeliverableRef {
  readonly id: string;
  readonly ticketId: string;
}

export interface DeliverableStorePort {
  getByTicket(ticketId: string): Promise<TicketDeliverableEntity[]>;
  getByTicketIds(ticketIds: string[]): Promise<TicketDeliverableEntity[]>;
  /**
   * Id + ticket of every deliverable on these tickets. Unread counts and the
   * Logs badges only count them (and match ids against the "seen" set):
   * selecting `*` dragged every markdown body along and hit Supabase's
   * statement timeout on the Kanban.
   */
  getRefsByTicketIds(ticketIds: string[]): Promise<DeliverableRef[]>;
  getById(id: string): Promise<TicketDeliverableEntity | null>;
  getAll(): Promise<TicketDeliverableEntity[]>;
  /**
   * Creation dates (ISO) of every deliverable created in [from, to], oldest
   * first — what Statistics counts, without loading any `content`.
   */
  getCreatedAtBetween(from: Date, to: Date): Promise<string[]>;
  /**
   * One page of deliverables, newest-updated first, plus the total number of
   * rows matching the filters. Backs the Documents view: the list stays bounded
   * while the header and the "load more" affordance know the real size.
   */
  query(options: DeliverableQueryOptions): Promise<DeliverableQueryResult>;
  /**
   * Distinct type / agent / status values with their counts, aggregated by the
   * database over every row — never over the page currently loaded.
   */
  getFacets(filters?: DeliverableQueryFilters): Promise<DeliverableFacetCounts>;
  /** Deliverables produced by a routine run — they have no ticket to hang off. */
  getByWorkflowRun(workflowRunId: string): Promise<TicketDeliverableEntity[]>;
  /**
   * Deliverables produced by one step run — the anchor the run graph reads to
   * render an artifact on the node that actually emitted it.
   */
  getByStepRun(stepRunId: string): Promise<TicketDeliverableEntity[]>;
  getByTicketAndType(ticketId: string, type: string): Promise<TicketDeliverableEntity | null>;
  getAllByType(type: string): Promise<TicketDeliverableEntity[]>;
  save(deliverable: TicketDeliverableEntity): Promise<void>;
  remove(id: string): Promise<void>;
}
