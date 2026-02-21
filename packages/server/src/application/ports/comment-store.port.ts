import type { TicketCommentEntity } from '../../domain/entities/ticket-comment.entity.js';

export interface CommentStorePort {
  getByTicket(ticketId: string): Promise<TicketCommentEntity[]>;
  getById(id: string): Promise<TicketCommentEntity | null>;
  save(comment: TicketCommentEntity): Promise<void>;
  remove(id: string): Promise<void>;
}
