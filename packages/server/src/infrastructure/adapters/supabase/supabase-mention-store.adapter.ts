import type { MentionStatus } from '@fleex/shared';
import { TicketMentionEntity } from '../../../domain/entities/ticket-mention.entity.js';
import type { MentionStorePort } from '../../../application/ports/mention-store.port.js';
import type { SupabaseConnection } from './connection.js';

interface MentionRow {
  id: string;
  ticket_id: string;
  comment_id: string;
  target_agent: string;
  source_agent: string;
  target_type: string | null;
  execution_mode: string;
  status: string;
  resolved_at: string | null;
  resolved_comment_id: string | null;
  resolved_deliverable_id: string | null;
  created_at: string;
}

function rowToEntity(r: MentionRow): TicketMentionEntity {
  return new TicketMentionEntity(
    r.id,
    r.ticket_id,
    r.comment_id,
    r.target_agent,
    r.source_agent,
    (r.target_type as 'agent' | 'human') ?? 'agent',
    (r.execution_mode as 'talk' | 'plan' | 'edit') ?? 'plan',
    r.status as MentionStatus,
    r.resolved_at ? new Date(r.resolved_at) : null,
    r.resolved_comment_id,
    r.resolved_deliverable_id,
    new Date(r.created_at),
  );
}

export class SupabaseMentionStore implements MentionStorePort {
  constructor(private readonly conn: SupabaseConnection) {}

  async getByTicket(ticketId: string): Promise<TicketMentionEntity[]> {
    const { data, error } = await this.conn.client
      .from('mentions')
      .select('*')
      .eq('ticket_id', ticketId);
    if (error) throw new Error(`SupabaseMentionStore.getByTicket failed: ${error.message}`);
    return (data as MentionRow[]).map(rowToEntity);
  }

  async getById(id: string): Promise<TicketMentionEntity | null> {
    const { data, error } = await this.conn.client
      .from('mentions')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`SupabaseMentionStore.getById failed: ${error.message}`);
    return data ? rowToEntity(data as MentionRow) : null;
  }

  async getByIds(ids: string[]): Promise<TicketMentionEntity[]> {
    if (ids.length === 0) return [];
    const { data, error } = await this.conn.client
      .from('mentions')
      .select('*')
      .in('id', ids);
    if (error) throw new Error(`SupabaseMentionStore.getByIds failed: ${error.message}`);
    return (data as MentionRow[]).map(rowToEntity);
  }

  async getAll(): Promise<TicketMentionEntity[]> {
    const { data, error } = await this.conn.client
      .from('mentions')
      .select('*')
      .order('created_at');
    if (error) throw new Error(`SupabaseMentionStore.getAll failed: ${error.message}`);
    return (data as MentionRow[]).map(rowToEntity);
  }

  async getByComment(commentId: string): Promise<TicketMentionEntity[]> {
    const { data, error } = await this.conn.client
      .from('mentions')
      .select('*')
      .eq('comment_id', commentId);
    if (error) throw new Error(`SupabaseMentionStore.getByComment failed: ${error.message}`);
    return (data as MentionRow[]).map(rowToEntity);
  }

  async getPendingForAgent(agentName: string): Promise<TicketMentionEntity[]> {
    const { data, error } = await this.conn.client
      .from('mentions')
      .select('*')
      .eq('target_agent', agentName)
      .not('status', 'in', '("resolved","waiting_for_info")');
    if (error) throw new Error(`SupabaseMentionStore.getPendingForAgent failed: ${error.message}`);
    return (data as MentionRow[]).map(rowToEntity);
  }

  async getPendingCountForTicket(ticketId: string): Promise<number> {
    const { count, error } = await this.conn.client
      .from('mentions')
      .select('*', { count: 'exact', head: true })
      .eq('ticket_id', ticketId)
      .neq('status', 'resolved');
    if (error) throw new Error(`SupabaseMentionStore.getPendingCountForTicket failed: ${error.message}`);
    return count ?? 0;
  }

  async getWaitingByTicket(ticketId: string): Promise<TicketMentionEntity[]> {
    const { data, error } = await this.conn.client
      .from('mentions')
      .select('*')
      .eq('ticket_id', ticketId)
      .eq('status', 'waiting_for_info');
    if (error) throw new Error(`SupabaseMentionStore.getWaitingByTicket failed: ${error.message}`);
    return (data as MentionRow[]).map(rowToEntity);
  }

  async save(mention: TicketMentionEntity): Promise<void> {
    const { error } = await this.conn.client.from('mentions').upsert({
      id: mention.id,
      ticket_id: mention.ticketId,
      comment_id: mention.commentId,
      target_agent: mention.targetAgent,
      source_agent: mention.sourceAgent,
      target_type: mention.targetType,
      execution_mode: mention.executionMode,
      status: mention.status,
      resolved_at: mention.resolvedAt?.toISOString() ?? null,
      resolved_comment_id: mention.resolvedCommentId,
      resolved_deliverable_id: mention.resolvedDeliverableId,
      created_at: mention.createdAt.toISOString(),
    });
    if (error) throw new Error(`SupabaseMentionStore.save failed: ${error.message}`);
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.conn.client
      .from('mentions')
      .delete()
      .eq('id', id);
    if (error) throw new Error(`SupabaseMentionStore.remove failed: ${error.message}`);
  }
}
