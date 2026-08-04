import type { TicketDeliverableEntity } from '../../domain/entities/ticket-deliverable.entity.js';

export interface DeliverableStorePort {
  getByTicket(ticketId: string): Promise<TicketDeliverableEntity[]>;
  getByTicketIds(ticketIds: string[]): Promise<TicketDeliverableEntity[]>;
  getById(id: string): Promise<TicketDeliverableEntity | null>;
  getAll(): Promise<TicketDeliverableEntity[]>;
  /** Deliverables produced by a routine run — they have no ticket to hang off. */
  getByWorkflowRun(workflowRunId: string): Promise<TicketDeliverableEntity[]>;
  getByTicketAndType(ticketId: string, type: string): Promise<TicketDeliverableEntity | null>;
  getAllByType(type: string): Promise<TicketDeliverableEntity[]>;
  save(deliverable: TicketDeliverableEntity): Promise<void>;
  remove(id: string): Promise<void>;
}
