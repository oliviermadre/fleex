import type { TicketDeliverableEntity } from '../../domain/entities/ticket-deliverable.entity.js';

export interface DeliverableStorePort {
  getByTicket(ticketId: string): TicketDeliverableEntity[];
  getById(id: string): TicketDeliverableEntity | null;
  save(deliverable: TicketDeliverableEntity): Promise<void>;
}
