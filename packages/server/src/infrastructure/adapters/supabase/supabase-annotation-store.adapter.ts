import type { AnnotationTone } from '@fleex/shared';
import { TimelineAnnotationEntity } from '../../../domain/entities/timeline-annotation.entity.js';
import type { AnnotationStorePort } from '../../../application/ports/annotation-store.port.js';
import type { SupabaseConnection } from './connection.js';

interface AnnotationRow {
  id: string;
  ticket_id: string;
  at: string;
  title: string;
  body: string | null;
  tone: string;
  source_comment_id: string | null;
  author_type: string;
  author_name: string;
  created_at: string;
  updated_at: string;
}

const TABLE = 'timeline_annotations';

export class SupabaseAnnotationStore implements AnnotationStorePort {
  constructor(private readonly conn: SupabaseConnection) {}

  async listByTicket(ticketId: string): Promise<TimelineAnnotationEntity[]> {
    const { data, error } = await this.conn.client
      .from(TABLE)
      .select('*')
      .eq('ticket_id', ticketId)
      .order('at', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) throw new Error(`SupabaseAnnotationStore.listByTicket failed: ${error.message}`);
    return (data as AnnotationRow[]).map(rowToEntity);
  }

  async getById(id: string): Promise<TimelineAnnotationEntity | null> {
    const { data, error } = await this.conn.client.from(TABLE).select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(`SupabaseAnnotationStore.getById failed: ${error.message}`);
    return data ? rowToEntity(data as AnnotationRow) : null;
  }

  async getBySourceComment(commentId: string): Promise<TimelineAnnotationEntity | null> {
    const { data, error } = await this.conn.client
      .from(TABLE)
      .select('*')
      .eq('source_comment_id', commentId)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`SupabaseAnnotationStore.getBySourceComment failed: ${error.message}`);
    return data ? rowToEntity(data as AnnotationRow) : null;
  }

  async save(a: TimelineAnnotationEntity): Promise<void> {
    const { error } = await this.conn.client.from(TABLE).upsert({
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
    if (error) throw new Error(`SupabaseAnnotationStore.save failed: ${error.message}`);
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.conn.client.from(TABLE).delete().eq('id', id);
    if (error) throw new Error(`SupabaseAnnotationStore.remove failed: ${error.message}`);
  }

  async clearSourceComment(commentId: string): Promise<void> {
    const { error } = await this.conn.client
      .from(TABLE)
      .update({ source_comment_id: null })
      .eq('source_comment_id', commentId);
    if (error) throw new Error(`SupabaseAnnotationStore.clearSourceComment failed: ${error.message}`);
  }
}

function rowToEntity(r: AnnotationRow): TimelineAnnotationEntity {
  return new TimelineAnnotationEntity(
    r.id, r.ticket_id, new Date(r.at), r.title, r.body ?? '', r.tone as AnnotationTone, r.source_comment_id,
    r.author_type as 'user' | 'agent', r.author_name, new Date(r.created_at), new Date(r.updated_at),
  );
}
