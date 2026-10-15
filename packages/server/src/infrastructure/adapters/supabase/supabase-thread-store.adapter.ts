import type { AgentThreadStatus, AgentThreadTargetType, AgentExecution } from '@fleex/shared';
import { parseParticipants } from '../sqlite/sqlite-thread-store.adapter.js';
import { AgentThreadEntity } from '../../../domain/entities/agent-thread.entity.js';
import type { ThreadStorePort } from '../../../application/ports/thread-store.port.js';
import type { SupabaseConnection } from './connection.js';

interface ThreadRow {
  id: string; ticket_id: string; persona_id: string; persona_name: string; assistant_persona_id: string;
  brief: string; forwarded_context: string; status: string; current_mention_id: string | null;
  exchanges: number; failures: number | null; summary: string | null; created_at: string; updated_at: string; concluded_at: string | null;
  target_type?: string | null; generated_title?: string | null; participants?: string | null;
}

function rowToEntity(r: ThreadRow): AgentThreadEntity {
  return new AgentThreadEntity(
    r.id, r.ticket_id, 'assistant', r.persona_id, r.persona_name, r.assistant_persona_id, r.brief,
    JSON.parse(r.forwarded_context) as string[], r.status as AgentThreadStatus, r.current_mention_id,
    Number(r.exchanges), Number(r.failures ?? 0), r.summary, new Date(r.created_at), new Date(r.updated_at),
    r.concluded_at ? new Date(r.concluded_at) : null, (r.target_type ?? 'agent') as AgentThreadTargetType,
    r.generated_title ?? null, parseParticipants(r.participants),
  );
}

export class SupabaseThreadStore implements ThreadStorePort {
  constructor(private readonly conn: SupabaseConnection) {}

  async getById(id: string): Promise<AgentThreadEntity | null> {
    const { data, error } = await this.conn.client.from('agent_threads').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(`SupabaseThreadStore.getById failed: ${error.message}`);
    return data ? rowToEntity(data as ThreadRow) : null;
  }

  async getByTicket(ticketId: string): Promise<AgentThreadEntity[]> {
    const { data, error } = await this.conn.client.from('agent_threads').select('*')
      .eq('ticket_id', ticketId).order('created_at', { ascending: false });
    if (error) throw new Error(`SupabaseThreadStore.getByTicket failed: ${error.message}`);
    return (data as ThreadRow[]).map(rowToEntity);
  }

  async getByCurrentMentionId(mentionId: string): Promise<AgentThreadEntity | null> {
    const { data, error } = await this.conn.client.from('agent_threads').select('*')
      .eq('current_mention_id', mentionId).order('updated_at', { ascending: false }).limit(1);
    if (error) throw new Error(`SupabaseThreadStore.getByCurrentMentionId failed: ${error.message}`);
    const rows = data as ThreadRow[];
    return rows.length > 0 ? rowToEntity(rows[0]!) : null;
  }

  async getOpen(): Promise<AgentThreadEntity[]> {
    const { data, error } = await this.conn.client.from('agent_threads').select('*')
      .in('status', ['running', 'waiting']).order('created_at', { ascending: false });
    if (error) throw new Error(`SupabaseThreadStore.getOpen failed: ${error.message}`);
    return (data as ThreadRow[]).map(rowToEntity);
  }

  async save(t: AgentThreadEntity): Promise<void> {
    const { error } = await this.conn.client.from('agent_threads').upsert({
      id: t.id, ticket_id: t.ticketId, initiator: t.initiator, persona_id: t.personaId,
      persona_name: t.personaName, assistant_persona_id: t.assistantPersonaId, brief: t.brief,
      forwarded_context: JSON.stringify(t.forwardedContext), status: t.status,
      current_mention_id: t.currentMentionId, exchanges: t.exchanges, failures: t.failures, summary: t.summary,
      created_at: t.createdAt.toISOString(), updated_at: t.updatedAt.toISOString(),
      concluded_at: t.concludedAt?.toISOString() ?? null, target_type: t.targetType,
      generated_title: t.generatedTitle, participants: JSON.stringify(t.participants),
    });
    if (error) throw new Error(`SupabaseThreadStore.save failed: ${error.message}`);
  }

  async getRunsByThreadAndStatus(threadId: string, activeStatuses: string[]): Promise<AgentExecution[]> {
    // Query path: thread → comments (by thread_id) → mentions (by comment_id) → executions (by mention_id)
    const { data, error } = await this.conn.client
      .from('agent_event_executions')
      .select(`
        execution_id, persona_id, ticket_id, mention_id, event_count, status,
        started_at, completed_at, last_event_at, sdk_session_id, model,
        effective_mode, effort, fast_mode, duration_ms, cost_usd,
        input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
        source, comment_id, deliverable_id,
        auto_terminated_at_conclusion, manually_terminated_by_user
      `)
      .in('mention_id',
        await this.getThreadMentionIds(threadId)
      )
      .in('status', activeStatuses);

    if (error) throw new Error(`SupabaseThreadStore.getRunsByThreadAndStatus failed: ${error.message}`);

    return (data as any[]).map(row => ({
      id: row.execution_id,
      personaId: row.persona_id,
      ticketId: row.ticket_id,
      mentionId: row.mention_id,
      eventCount: row.event_count,
      status: row.status,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      lastEventAt: row.last_event_at,
      sdkSessionId: row.sdk_session_id,
      model: row.model,
      effectiveMode: row.effective_mode,
      effort: row.effort,
      fast: row.fast_mode ? Boolean(row.fast_mode) : null,
      durationMs: row.duration_ms,
      costUsd: row.cost_usd,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      cacheReadTokens: row.cache_read_tokens,
      cacheCreationTokens: row.cache_creation_tokens,
      source: row.source,
      commentId: row.comment_id,
      deliverableId: row.deliverable_id,
      autoTerminatedAtConclusion: row.auto_terminated_at_conclusion ? Boolean(row.auto_terminated_at_conclusion) : null,
      manuallyTerminatedByUser: row.manually_terminated_by_user ? Boolean(row.manually_terminated_by_user) : null,
    }));
  }

  private async getThreadMentionIds(threadId: string): Promise<string[]> {
    const { data, error } = await this.conn.client
      .from('mentions')
      .select('id')
      .in('comment_id',
        await this.getThreadCommentIds(threadId)
      );

    if (error) throw new Error(`SupabaseThreadStore.getThreadMentionIds failed: ${error.message}`);
    return (data as any[]).map(m => m.id);
  }

  private async getThreadCommentIds(threadId: string): Promise<string[]> {
    const { data, error } = await this.conn.client
      .from('comments')
      .select('id')
      .eq('thread_id', threadId);

    if (error) throw new Error(`SupabaseThreadStore.getThreadCommentIds failed: ${error.message}`);
    return (data as any[]).map(c => c.id);
  }
}
