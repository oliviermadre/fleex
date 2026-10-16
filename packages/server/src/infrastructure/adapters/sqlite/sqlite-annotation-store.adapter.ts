import type { AnnotationTone } from '@fleex/shared';
import { TimelineAnnotationEntity } from '../../../domain/entities/timeline-annotation.entity.js';
import type { AnnotationStorePort } from '../../../application/ports/annotation-store.port.js';
import type { SqliteConnection } from './connection.js';

interface AnnotationRow {
  id: string;
  ticket_id: string;
  at: string;
  title: string;
  body: string;
  tone: string;
  source_comment_id: string | null;
  author_type: string;
  author_name: string;
  created_at: string;
  updated_at: string;
}

export class SqliteAnnotationStoreAdapter implements AnnotationStorePort {
  constructor(private readonly conn: SqliteConnection) {}

  async listByTicket(ticketId: string): Promise<TimelineAnnotationEntity[]> {
    const rows = this.conn.db
      .prepare('SELECT * FROM timeline_annotations WHERE ticket_id = ? ORDER BY at ASC, created_at ASC')
      .all(ticketId) as AnnotationRow[];
    return rows.map(toEntity);
  }

  async getById(id: string): Promise<TimelineAnnotationEntity | null> {
    const row = this.conn.db.prepare('SELECT * FROM timeline_annotations WHERE id = ?').get(id) as AnnotationRow | undefined;
    return row ? toEntity(row) : null;
  }

  async getBySourceComment(commentId: string): Promise<TimelineAnnotationEntity | null> {
    const row = this.conn.db
      .prepare('SELECT * FROM timeline_annotations WHERE source_comment_id = ? LIMIT 1')
      .get(commentId) as AnnotationRow | undefined;
    return row ? toEntity(row) : null;
  }

  async save(a: TimelineAnnotationEntity): Promise<void> {
    // Upsert, not INSERT OR REPLACE: REPLACE deletes the row first.
    this.conn.db.prepare(`
      INSERT INTO timeline_annotations
        (id, ticket_id, at, title, body, tone, source_comment_id, author_type, author_name, created_at, updated_at)
      VALUES
        (@id, @ticket_id, @at, @title, @body, @tone, @source_comment_id, @author_type, @author_name, @created_at, @updated_at)
      ON CONFLICT(id) DO UPDATE SET
        at = excluded.at, title = excluded.title, body = excluded.body, tone = excluded.tone,
        source_comment_id = excluded.source_comment_id, updated_at = excluded.updated_at
    `).run({
      id: a.id,
      ticket_id: a.ticketId,
      at: a.at.toISOString(),
      title: a.title,
      body: a.body,
      tone: a.tone,
      source_comment_id: a.sourceCommentId,
      author_type: a.authorType,
      author_name: a.authorName,
      created_at: a.createdAt.toISOString(),
      updated_at: a.updatedAt.toISOString(),
    });
  }

  async remove(id: string): Promise<void> {
    this.conn.db.prepare('DELETE FROM timeline_annotations WHERE id = ?').run(id);
  }

  async clearSourceComment(commentId: string): Promise<void> {
    this.conn.db.prepare('UPDATE timeline_annotations SET source_comment_id = NULL WHERE source_comment_id = ?').run(commentId);
  }
}

function toEntity(r: AnnotationRow): TimelineAnnotationEntity {
  return new TimelineAnnotationEntity(
    r.id, r.ticket_id, new Date(r.at), r.title, r.body, r.tone as AnnotationTone, r.source_comment_id,
    r.author_type as 'user' | 'agent', r.author_name, new Date(r.created_at), new Date(r.updated_at),
  );
}
