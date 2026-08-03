import type { CommentVisibility } from '@fleex/shared';

import { TicketCommentEntity } from '../../../domain/entities/ticket-comment.entity.js';

import { chunkIds } from './supabase-chunk.js';

import type { SupabaseConnection } from './connection.js';
import type { CommentStorePort } from '../../../application/ports/comment-store.port.js';

interface CommentRow {
  id: string;
  ticket_id: string;
  author_type: string;
  author_name: string;
  body: string;
  visibility: string;
  private_recipients: string[];
  mentions: string[];
  parent_id: string | null;
  created_at: string;
  updated_at: string;
}

function rowToEntity(r: CommentRow): TicketCommentEntity {
  return new TicketCommentEntity(
    r.id,
    r.ticket_id,
    r.author_type as 'user' | 'agent',
    r.author_name,
    r.body,
    r.visibility as CommentVisibility,
    r.private_recipients ?? [],
    r.mentions ?? [],
    r.parent_id,
    new Date(r.created_at),
    new Date(r.updated_at),
  );
}

export class SupabaseCommentStore implements CommentStorePort {
  constructor(private readonly conn: SupabaseConnection) {}

  async getByTicket(ticketId: string): Promise<TicketCommentEntity[]> {
    const { data, error } = await this.conn.client
      .from('comments')
      .select('*')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: true });
    if (error) throw new Error(`SupabaseCommentStore.getByTicket failed: ${error.message}`);
    return (data as CommentRow[]).map(rowToEntity);
  }

  async getByTicketIds(ticketIds: string[]): Promise<TicketCommentEntity[]> {
    if (ticketIds.length === 0) return [];
    // PostgREST silently caps responses at max-rows (Supabase default: 1000).
    // Bulk callers (unread-counts for the cockpit view) can match far more, so
    // paginate explicitly — otherwise counts silently truncate (bug #400).
    // The secondary `id` order makes pagination stable across equal timestamps.
    // `.in()` lands in the query string, which Supabase's proxy caps at ~8 KB —
    // so the ID list is chunked before paginating each chunk (#509).
    const PAGE = 1000;
    const rows: CommentRow[] = [];
    for (const chunk of chunkIds(ticketIds)) {
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await this.conn.client
          .from('comments')
          .select('*')
          .in('ticket_id', chunk)
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) throw new Error(`SupabaseCommentStore.getByTicketIds failed: ${error.message}`);
        const page = data as CommentRow[];
        rows.push(...page);
        if (page.length < PAGE) break;
      }
    }
    return rows.map(rowToEntity);
  }

  async getById(id: string): Promise<TicketCommentEntity | null> {
    const { data, error } = await this.conn.client
      .from('comments')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`SupabaseCommentStore.getById failed: ${error.message}`);
    return data ? rowToEntity(data as CommentRow) : null;
  }

  async getAll(): Promise<TicketCommentEntity[]> {
    const { data, error } = await this.conn.client
      .from('comments')
      .select('*')
      .order('created_at', { ascending: true });
    if (error) throw new Error(`SupabaseCommentStore.getAll failed: ${error.message}`);
    return (data as CommentRow[]).map(rowToEntity);
  }

  async save(comment: TicketCommentEntity): Promise<void> {
    const { error } = await this.conn.client.from('comments').upsert({
      id: comment.id,
      ticket_id: comment.ticketId,
      author_type: comment.authorType,
      author_name: comment.authorName,
      body: comment.body,
      visibility: comment.visibility,
      private_recipients: comment.privateRecipients,
      mentions: comment.mentions,
      parent_id: comment.parentId,
      created_at: comment.createdAt.toISOString(),
      updated_at: comment.updatedAt.toISOString(),
    });
    if (error) throw new Error(`SupabaseCommentStore.save failed: ${error.message}`);
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.conn.client.from('comments').delete().eq('id', id);
    if (error) throw new Error(`SupabaseCommentStore.remove failed: ${error.message}`);
  }
}
