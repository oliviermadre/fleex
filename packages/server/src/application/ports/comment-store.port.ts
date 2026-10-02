import type { TicketCommentEntity } from '../../domain/entities/ticket-comment.entity.js';

/** What Statistics counts on a comment — no body, so reading them all stays light. */
export interface CommentSummary {
  readonly ticketId: string;
  readonly createdAt: string;
  readonly authorType: 'user' | 'agent';
}

export interface CommentStorePort {
  getByTicket(ticketId: string): Promise<TicketCommentEntity[]>;
  getByTicketIds(ticketIds: string[]): Promise<TicketCommentEntity[]>;
  getById(id: string): Promise<TicketCommentEntity | null>;
  getAll(): Promise<TicketCommentEntity[]>;
  /** Every comment without its body (ticket, author type, creation date), oldest first. */
  getAllSummaries(): Promise<CommentSummary[]>;
  /**
   * Same summaries, scoped to these tickets — what unread counts need (ticket +
   * creation date), without pulling every comment body (Kanban timeouts).
   */
  getSummariesByTicketIds(ticketIds: string[]): Promise<CommentSummary[]>;
  save(comment: TicketCommentEntity): Promise<void>;
  remove(id: string): Promise<void>;
}
