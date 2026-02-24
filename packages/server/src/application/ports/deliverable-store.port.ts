import type { TicketDeliverableEntity } from '../../domain/entities/ticket-deliverable.entity.js';

export interface DeliverableStorePort {
  getByTicket(ticketId: string): Promise<TicketDeliverableEntity[]>;
  getById(id: string): Promise<TicketDeliverableEntity | null>;
  save(deliverable: TicketDeliverableEntity): Promise<void>;
}
