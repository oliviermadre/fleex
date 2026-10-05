import type { AgentQuestion, CommentVisibility } from '@fleex/shared';
import { TicketCommentEntity } from '../../../domain/entities/ticket-comment.entity.js';
import type { CommentSummary, CommentStorePort } from '../../../application/ports/comment-store.port.js';
import type { SqliteConnection } from './connection.js';

interface CommentRow {
  id: string;
  ticket_id: string;
  author_type: string;
  author_name: string;
  body: string;
  visibility: string;
  private_recipients: string;
  mentions: string;
  parent_id: string | null;
  questions: string | null;
  created_at: string;
  updated_at: string;
}

export class SqliteCommentStoreAdapter implements CommentStorePort {
  constructor(private readonly conn: SqliteConnection) {}

  async getByTicket(ticketId: string): Promise<TicketCommentEntity[]> {
    const rows = this.conn.db
      .prepare('SELECT * FROM comments WHERE ticket_id = ? ORDER BY created_at ASC')
      .all(ticketId) as CommentRow[];
    return rows.map((r) => this.toEntity(r));
  }

  async getByTicketIds(ticketIds: string[]): Promise<TicketCommentEntity[]> {
    if (ticketIds.length === 0) return [];
    const placeholders = ticketIds.map(() => '?').join(',');
    const rows = this.conn.db
      .prepare(`SELECT * FROM comments WHERE ticket_id IN (${placeholders}) ORDER BY created_at ASC`)
      .all(...ticketIds) as CommentRow[];
    return rows.map((r) => this.toEntity(r));
  }

  async getById(id: string): Promise<TicketCommentEntity | null> {
    const row = this.conn.db
      .prepare('SELECT * FROM comments WHERE id = ?')
      .get(id) as CommentRow | undefined;
    return row ? this.toEntity(row) : null;
  }

  async getAll(): Promise<TicketCommentEntity[]> {
    const rows = this.conn.db
      .prepare('SELECT * FROM comments ORDER BY created_at ASC')
      .all() as CommentRow[];
    return rows.map((r) => this.toEntity(r));
  }

  async getAllSummaries(): Promise<CommentSummary[]> {
    const rows = this.conn.db
      .prepare('SELECT ticket_id, created_at, author_type FROM comments ORDER BY created_at ASC')
      .all() as { ticket_id: string; created_at: string; author_type: string }[];
    return rows.map((r) => ({ ticketId: r.ticket_id, createdAt: r.created_at, authorType: r.author_type as 'user' | 'agent' }));
  }

  async getSummariesByTicketIds(ticketIds: string[]): Promise<CommentSummary[]> {
    if (ticketIds.length === 0) return [];
    const placeholders = ticketIds.map(() => '?').join(',');
    const rows = this.conn.db
      .prepare(`SELECT ticket_id, created_at, author_type FROM comments WHERE ticket_id IN (${placeholders}) ORDER BY created_at ASC`)
      .all(...ticketIds) as { ticket_id: string; created_at: string; author_type: string }[];
    return rows.map((r) => ({ ticketId: r.ticket_id, createdAt: r.created_at, authorType: r.author_type as 'user' | 'agent' }));
  }

  async save(comment: TicketCommentEntity): Promise<void> {
    const stmt = this.conn.db.prepare(`
      INSERT OR REPLACE INTO comments
        (id, ticket_id, author_type, author_name, body, visibility,
         private_recipients, mentions, parent_id, questions, created_at, updated_at)
      VALUES
        (@id, @ticket_id, @author_type, @author_name, @body, @visibility,
         @private_recipients, @mentions, @parent_id, @questions, @created_at, @updated_at)
    `);

    stmt.run({
      id: comment.id,
      ticket_id: comment.ticketId,
      author_type: comment.authorType,
      author_name: comment.authorName,
      body: comment.body,
      visibility: comment.visibility,
      private_recipients: JSON.stringify(comment.privateRecipients),
      mentions: JSON.stringify(comment.mentions),
      parent_id: comment.parentId,
      questions: comment.questions ? JSON.stringify(comment.questions) : null,
      created_at: comment.createdAt.toISOString(),
      updated_at: comment.updatedAt.toISOString(),
    });
  }

  async remove(id: string): Promise<void> {
    this.conn.db.prepare('DELETE FROM comments WHERE id = ?').run(id);
  }

  private toEntity(row: CommentRow): TicketCommentEntity {
    return new TicketCommentEntity(
      row.id,
      row.ticket_id,
      row.author_type as 'user' | 'agent',
      row.author_name,
      row.body,
      row.visibility as CommentVisibility,
      JSON.parse(row.private_recipients) as string[],
      JSON.parse(row.mentions) as string[],
      row.parent_id,
      new Date(row.created_at),
      new Date(row.updated_at),
      parseQuestions(row.questions),
    );
  }
}

/** A NULL or unreadable cell reads as "no questions" — never fail a comment read over it. */
function parseQuestions(raw: string | null): AgentQuestion[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AgentQuestion[]) : null;
  } catch {
    return null;
  }
}
