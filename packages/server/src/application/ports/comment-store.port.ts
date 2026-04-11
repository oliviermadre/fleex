import type { TicketCommentEntity } from '../../domain/entities/ticket-comment.entity.js';

export interface CommentStorePort {
  getByTicket(ticketId: string): Promise<TicketCommentEntity[]>;
  getByTicketIds(ticketIds: string[]): Promise<TicketCommentEntity[]>;
  getById(id: string): Promise<TicketCommentEntity | null>;
  getAll(): Promise<TicketCommentEntity[]>;
  save(comment: TicketCommentEntity): Promise<void>;
  remove(id: string): Promise<void>;
}
