import type { TicketMentionEntity } from '../../domain/entities/ticket-mention.entity.js';

export interface MentionStorePort {
  getByTicket(ticketId: string): TicketMentionEntity[];
  getById(id: string): TicketMentionEntity | null;
  getByComment(commentId: string): TicketMentionEntity[];
  getPendingForAgent(agentName: string): TicketMentionEntity[];
  getPendingCountForTicket(ticketId: string): number;
  save(mention: TicketMentionEntity): Promise<void>;
  remove(id: string): Promise<void>;
}
