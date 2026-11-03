import type { AgentThreadStatus, AgentThreadTargetType, AgentExecution } from '@fleex/shared';
import { parseParticipants } from '../sqlite/sqlite-thread-store.adapter.js';
import { AgentThreadEntity } from '../../../domain/entities/agent-thread.entity.js';
import type { ThreadStorePort } from '../../../application/ports/thread-store.port.js';
import type { PgConnection } from './connection.js';

function rowToThread(row: Record<string, unknown>): AgentThreadEntity {
  return new AgentThreadEntity(
    row.id as string, row.ticket_id as string, 'assistant', row.persona_id as string, row.persona_name as string,
    row.assistant_persona_id as string, row.brief as string, JSON.parse(row.forwarded_context as string) as string[],
    row.status as AgentThreadStatus, (row.current_mention_id as string | null) ?? null, Number(row.exchanges),
    Number(row.failures ?? 0), (row.summary as string | null) ?? null, new Date(row.created_at as string), new Date(row.updated_at as string),
    row.concluded_at ? new Date(row.concluded_at as string) : null,
    ((row.target_type as string | null) ?? 'agent') as AgentThreadTargetType,
    (row.generated_title as string | null) ?? null, parseParticipants(row.participants as string | null),
  );
}

export class PgThreadStore implements ThreadStorePort {
  constructor(private readonly db: PgConnection) {}

  async getById(id: string): Promise<AgentThreadEntity | null> {
    const { rows } = await this.db.query('SELECT * FROM agent_threads WHERE id = $1', [id]);
    return rows.length > 0 ? rowToThread(rows[0]) : null;
  }

  async getByTicket(ticketId: string): Promise<AgentThreadEntity[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM agent_threads WHERE ticket_id = $1 ORDER BY created_at DESC, id DESC',
      [ticketId],
    );
    return rows.map(rowToThread);
  }

  async getByCurrentMentionId(mentionId: string): Promise<AgentThreadEntity | null> {
    const { rows } = await this.db.query(
      'SELECT * FROM agent_threads WHERE current_mention_id = $1 ORDER BY updated_at DESC LIMIT 1',
      [mentionId],
    );
    return rows.length > 0 ? rowToThread(rows[0]) : null;
  }

  async getOpen(): Promise<AgentThreadEntity[]> {
    const { rows } = await this.db.query(
      `SELECT * FROM agent_threads WHERE status IN ('running','waiting') ORDER BY created_at DESC`,
    );
    return rows.map(rowToThread);
  }

  async save(t: AgentThreadEntity): Promise<void> {
    await this.db.query(
      `INSERT INTO agent_threads (id, ticket_id, initiator, persona_id, persona_name, assistant_persona_id, brief,
         forwarded_context, status, current_mention_id, exchanges, summary, created_at, updated_at, concluded_at, failures, target_type, generated_title, participants)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       ON CONFLICT (id) DO UPDATE SET status = $9, current_mention_id = $10, exchanges = $11, summary = $12,
         updated_at = $14, concluded_at = $15, failures = $16,
         generated_title = $18, participants = $19`,
      [t.id, t.ticketId, t.initiator, t.personaId, t.personaName, t.assistantPersonaId, t.brief,
       JSON.stringify(t.forwardedContext), t.status, t.currentMentionId, t.exchanges, t.summary,
       t.createdAt.toISOString(), t.updatedAt.toISOString(), t.concludedAt?.toISOString() ?? null, t.failures, t.targetType,
       t.generatedTitle, JSON.stringify(t.participants)],
    );
  }

  async getRunsByThreadAndStatus(threadId: string, activeStatuses: string[]): Promise<AgentExecution[]> {
    // Query path: thread → comments (by thread_id) → mentions (by comment_id) → executions (by mention_id)
    const { rows } = await this.db.query(
      `SELECT DISTINCT
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
      WHERE c.thread_id = $1 AND e.status = ANY($2)`,
      [threadId, activeStatuses],
    );

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
