import type { AnnotationTone } from '@fleex/shared';
import { TimelineAnnotationEntity } from '../../../domain/entities/timeline-annotation.entity.js';
import type { AnnotationStorePort } from '../../../application/ports/annotation-store.port.js';
import type { PgConnection } from './connection.js';

export class PgAnnotationStore implements AnnotationStorePort {
  constructor(private readonly db: PgConnection) {}

  async listByTicket(ticketId: string): Promise<TimelineAnnotationEntity[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM timeline_annotations WHERE ticket_id = $1 ORDER BY at ASC, created_at ASC',
      [ticketId],
    );
    return rows.map(rowToEntity);
  }

  async getById(id: string): Promise<TimelineAnnotationEntity | null> {
    const { rows } = await this.db.query('SELECT * FROM timeline_annotations WHERE id = $1', [id]);
    return rows.length > 0 ? rowToEntity(rows[0]) : null;
  }

  async getBySourceComment(commentId: string): Promise<TimelineAnnotationEntity | null> {
    const { rows } = await this.db.query('SELECT * FROM timeline_annotations WHERE source_comment_id = $1 LIMIT 1', [commentId]);
    return rows.length > 0 ? rowToEntity(rows[0]) : null;
  }

  async save(a: TimelineAnnotationEntity): Promise<void> {
    await this.db.query(
      `INSERT INTO timeline_annotations (
        id, ticket_id, at, title, body, tone, source_comment_id, author_type, author_name, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT (id) DO UPDATE SET
        at = $3, title = $4, body = $5, tone = $6, source_comment_id = $7, updated_at = $11`,
      [
        a.id, a.ticketId, a.at.toISOString(), a.title, a.body, a.tone, a.sourceCommentId,
        a.authorType, a.authorName, a.createdAt.toISOString(), a.updatedAt.toISOString(),
      ],
    );
  }

  async remove(id: string): Promise<void> {
    await this.db.query('DELETE FROM timeline_annotations WHERE id = $1', [id]);
  }

  async clearSourceComment(commentId: string): Promise<void> {
    await this.db.query('UPDATE timeline_annotations SET source_comment_id = NULL WHERE source_comment_id = $1', [commentId]);
  }
}

function rowToEntity(row: Record<string, unknown>): TimelineAnnotationEntity {
  return new TimelineAnnotationEntity(
    row.id as string,
    row.ticket_id as string,
    new Date(row.at as string | Date),
    row.title as string,
    (row.body as string) ?? '',
    row.tone as AnnotationTone,
    (row.source_comment_id as string | null) ?? null,
    row.author_type as 'user' | 'agent',
    row.author_name as string,
    new Date(row.created_at as string | Date),
    new Date(row.updated_at as string | Date),
  );
}
