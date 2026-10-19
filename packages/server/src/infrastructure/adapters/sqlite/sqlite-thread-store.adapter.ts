import type { AgentThreadStatus, AgentThreadTargetType, AgentExecution, ThreadParticipant } from '@fleex/shared';
import { AgentThreadEntity } from '../../../domain/entities/agent-thread.entity.js';
import type { ThreadStorePort } from '../../../application/ports/thread-store.port.js';
import type { SqliteConnection } from './connection.js';

interface ThreadRow {
  id: string; ticket_id: string; initiator: string; persona_id: string; persona_name: string;
  assistant_persona_id: string; brief: string; forwarded_context: string; status: string;
  current_mention_id: string | null; exchanges: number; failures: number; summary: string | null;
  created_at: string; updated_at: string; concluded_at: string | null; target_type: string | null;
  generated_title: string | null; participants: string | null;
}

/** `participants` is a JSON array in a TEXT column; rows written before migration 046 hold NULL. */
export function parseParticipants(raw: string | null | undefined): ThreadParticipant[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ThreadParticipant[]) : [];
  } catch {
    return [];
  }
}

export function threadRowToEntity(r: ThreadRow): AgentThreadEntity {
  return new AgentThreadEntity(
    r.id, r.ticket_id, 'assistant', r.persona_id, r.persona_name, r.assistant_persona_id, r.brief,
    JSON.parse(r.forwarded_context) as string[], r.status as AgentThreadStatus, r.current_mention_id,
    Number(r.exchanges), Number(r.failures ?? 0), r.summary, new Date(r.created_at), new Date(r.updated_at),
    r.concluded_at ? new Date(r.concluded_at) : null, (r.target_type ?? 'agent') as AgentThreadTargetType,
    r.generated_title ?? null, parseParticipants(r.participants),
  );
}

export function threadEntityToRow(t: AgentThreadEntity): ThreadRow {
  return {
    id: t.id, ticket_id: t.ticketId, initiator: t.initiator, persona_id: t.personaId,
    persona_name: t.personaName, assistant_persona_id: t.assistantPersonaId, brief: t.brief,
    forwarded_context: JSON.stringify(t.forwardedContext), status: t.status,
    current_mention_id: t.currentMentionId, exchanges: t.exchanges, failures: t.failures, summary: t.summary,
    created_at: t.createdAt.toISOString(), updated_at: t.updatedAt.toISOString(),
    concluded_at: t.concludedAt?.toISOString() ?? null, target_type: t.targetType,
    generated_title: t.generatedTitle, participants: JSON.stringify(t.participants),
  };
}

export class SqliteThreadStoreAdapter implements ThreadStorePort {
  constructor(private readonly conn: SqliteConnection) {}

  async getById(id: string): Promise<AgentThreadEntity | null> {
    const row = this.conn.db.prepare('SELECT * FROM agent_threads WHERE id = ?').get(id) as ThreadRow | undefined;
    return row ? threadRowToEntity(row) : null;
  }

  async getByTicket(ticketId: string): Promise<AgentThreadEntity[]> {
    const rows = this.conn.db
      .prepare('SELECT * FROM agent_threads WHERE ticket_id = ? ORDER BY created_at DESC, id DESC')
      .all(ticketId) as ThreadRow[];
    return rows.map(threadRowToEntity);
  }

  async getByCurrentMentionId(mentionId: string): Promise<AgentThreadEntity | null> {
    const row = this.conn.db
      .prepare('SELECT * FROM agent_threads WHERE current_mention_id = ? ORDER BY updated_at DESC LIMIT 1')
      .get(mentionId) as ThreadRow | undefined;
    return row ? threadRowToEntity(row) : null;
  }

  async getOpen(): Promise<AgentThreadEntity[]> {
    const rows = this.conn.db
      .prepare(`SELECT * FROM agent_threads WHERE status IN ('running', 'waiting') ORDER BY created_at DESC`)
      .all() as ThreadRow[];
    return rows.map(threadRowToEntity);
  }

  async save(thread: AgentThreadEntity): Promise<void> {
    this.conn.db.prepare(`
      INSERT OR REPLACE INTO agent_threads
        (id, ticket_id, initiator, persona_id, persona_name, assistant_persona_id, brief, forwarded_context,
         status, current_mention_id, exchanges, failures, summary, created_at, updated_at, concluded_at, target_type,
         generated_title, participants)
      VALUES
        (@id, @ticket_id, @initiator, @persona_id, @persona_name, @assistant_persona_id, @brief, @forwarded_context,
         @status, @current_mention_id, @exchanges, @failures, @summary, @created_at, @updated_at, @concluded_at, @target_type,
         @generated_title, @participants)
    `).run(threadEntityToRow(thread));
  }

  async getRunsByThreadAndStatus(threadId: string, activeStatuses: string[]): Promise<AgentExecution[]> {
    // Query path: thread → comments (by thread_id) → mentions (by comment_id) → executions (by mention_id)
    const placeholders = activeStatuses.map(() => '?').join(',');
    const sql = `
      SELECT DISTINCT
        e.execution_id as id,
        e.persona_id as personaId,
        e.ticket_id as ticketId,
        e.mention_id as mentionId,
        e.event_count as eventCount,
        e.status,
        e.started_at as startedAt,
        e.completed_at as completedAt,
        e.last_event_at as lastEventAt,
        e.sdk_session_id as sdkSessionId,
        e.model,
        e.effective_mode as effectiveMode,
        e.effort,
        e.fast_mode as fast,
        e.duration_ms as durationMs,
        e.cost_usd as costUsd,
        e.input_tokens as inputTokens,
        e.output_tokens as outputTokens,
        e.cache_read_tokens as cacheReadTokens,
        e.cache_creation_tokens as cacheCreationTokens,
        e.source,
        e.comment_id as commentId,
        e.deliverable_id as deliverableId,
        e.auto_terminated_at_conclusion as autoTerminatedAtConclusion,
        e.manually_terminated_by_user as manuallyTerminatedByUser
      FROM agent_event_executions e
      INNER JOIN mentions m ON e.mention_id = m.id
      INNER JOIN comments c ON m.comment_id = c.id
      WHERE c.thread_id = ? AND e.status IN (${placeholders})
    `;
    const rows = this.conn.db.prepare(sql).all(threadId, ...activeStatuses) as any[];
    return rows.map(row => ({
      id: row.id,
      personaId: row.personaId,
      ticketId: row.ticketId,
      mentionId: row.mentionId,
      eventCount: row.eventCount,
      status: row.status,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      lastEventAt: row.lastEventAt,
      sdkSessionId: row.sdkSessionId,
      model: row.model,
      effectiveMode: row.effectiveMode,
      effort: row.effort,
      fast: row.fast ? Boolean(row.fast) : null,
      durationMs: row.durationMs,
      costUsd: row.costUsd,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      cacheReadTokens: row.cacheReadTokens,
      cacheCreationTokens: row.cacheCreationTokens,
      source: row.source,
      commentId: row.commentId,
      deliverableId: row.deliverableId,
      autoTerminatedAtConclusion: row.autoTerminatedAtConclusion ? Boolean(row.autoTerminatedAtConclusion) : null,
      manuallyTerminatedByUser: row.manuallyTerminatedByUser ? Boolean(row.manuallyTerminatedByUser) : null,
    }));
  }
}
