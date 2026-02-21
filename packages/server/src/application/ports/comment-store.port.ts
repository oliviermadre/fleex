import type { TicketCommentEntity } from '../../domain/entities/ticket-comment.entity.js';

export interface CommentStorePort {
  getByTicket(ticketId: string): TicketCommentEntity[];
  getById(id: string): TicketCommentEntity | null;
  save(comment: TicketCommentEntity): Promise<void>;
  remove(id: string): Promise<void>;
}
