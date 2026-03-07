import type { TicketMentionEntity } from '../../domain/entities/ticket-mention.entity.js';

export interface MentionStorePort {
  getByTicket(ticketId: string): Promise<TicketMentionEntity[]>;
  getById(id: string): Promise<TicketMentionEntity | null>;
  getByComment(commentId: string): Promise<TicketMentionEntity[]>;
  getPendingForAgent(agentName: string): Promise<TicketMentionEntity[]>;
  getPendingCountForTicket(ticketId: string): Promise<number>;
  getWaitingByTicket(ticketId: string): Promise<TicketMentionEntity[]>;
  getAll(): Promise<TicketMentionEntity[]>;
  save(mention: TicketMentionEntity): Promise<void>;
  remove(id: string): Promise<void>;
}
