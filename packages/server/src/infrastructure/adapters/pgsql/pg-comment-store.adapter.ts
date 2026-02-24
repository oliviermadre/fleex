import type { CommentVisibility } from '@asm/shared';
import { TicketCommentEntity } from '../../../domain/entities/ticket-comment.entity.js';
import type { CommentStorePort } from '../../../application/ports/comment-store.port.js';
import type { PgConnection } from './connection.js';

export class PgCommentStore implements CommentStorePort {
  constructor(private readonly db: PgConnection) {}

  async getByTicket(ticketId: string): Promise<TicketCommentEntity[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM comments WHERE ticket_id = $1 ORDER BY created_at ASC',
      [ticketId],
    );
    return rows.map(rowToComment);
  }

  async getById(id: string): Promise<TicketCommentEntity | null> {
    const { rows } = await this.db.query('SELECT * FROM comments WHERE id = $1', [id]);
    return rows.length > 0 ? rowToComment(rows[0]) : null;
  }

  async save(comment: TicketCommentEntity): Promise<void> {
    await this.db.query(
      `INSERT INTO comments (
        id, ticket_id, author_type, author_name, body, visibility,
        private_recipients, mentions, parent_id, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT (id) DO UPDATE SET
        ticket_id = $2,
        author_type = $3,
        author_name = $4,
        body = $5,
        visibility = $6,
        private_recipients = $7,
        mentions = $8,
        parent_id = $9,
        created_at = $10,
        updated_at = $11`,
      [
        comment.id,
        comment.ticketId,
        comment.authorType,
        comment.authorName,
        comment.body,
        comment.visibility,
        JSON.stringify(comment.privateRecipients),
        JSON.stringify(comment.mentions),
        comment.parentId,
        comment.createdAt.toISOString(),
        comment.updatedAt.toISOString(),
      ],
    );
  }

  async remove(id: string): Promise<void> {
    await this.db.query('DELETE FROM comments WHERE id = $1', [id]);
  }
}

function rowToComment(row: Record<string, unknown>): TicketCommentEntity {
  return new TicketCommentEntity(
    row.id as string,
    row.ticket_id as string,
    row.author_type as 'user' | 'agent',
    row.author_name as string,
    row.body as string,
    (row.visibility as CommentVisibility) ?? 'public',
    (row.private_recipients as string[]) ?? [],
    (row.mentions as string[]) ?? [],
    (row.parent_id as string) ?? null,
    new Date(row.created_at as string),
    new Date(row.updated_at as string),
  );
}
