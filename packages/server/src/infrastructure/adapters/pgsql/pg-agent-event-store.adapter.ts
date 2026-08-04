import { join } from 'node:path';
import { appendFile, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { FLEEX_DIR } from '@fleex/shared';
import type { AgentExecution } from '@fleex/shared';
import { AgentEventEntity } from '../../../domain/entities/agent-event.entity.js';
import type { AgentEventStorePort, CliExecutionUpsert, StaleExecution } from '../../../application/ports/agent-event-store.port.js';
import type { PgConnection } from './connection.js';

export class PgAgentEventStore implements AgentEventStorePort {
  private readonly eventsDir: string;

  constructor(private readonly db: PgConnection) {
    this.eventsDir = join(homedir(), FLEEX_DIR, 'projects', 'agent-events');
  }

  async init(): Promise<void> {
    if (!existsSync(this.eventsDir)) {
      await mkdir(this.eventsDir, { recursive: true });
    }
  }

  async startExecution(params: {
    executionId: string;
    personaId: string;
    ticketId: string;
    mentionId: string;
    model?: string;
    effort?: string;
    fast?: boolean;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO agent_event_executions
        (execution_id, persona_id, ticket_id, mention_id, event_count, status, started_at, model, effort, fast_mode)
       VALUES ($1, $2, $3, $4, 0, 'running', $5, $6, $7, $8)`,
      [params.executionId, params.personaId, params.ticketId, params.mentionId, new Date().toISOString(),
       params.model ?? null, params.effort ?? null, params.fast ?? null],
    );
  }

  async appendEvent(event: AgentEventEntity): Promise<void> {
    const filePath = join(this.eventsDir, `${event.executionId}.jsonl`);
    const line = JSON.stringify(event.toDTO()) + '\n';
    await appendFile(filePath, line, 'utf-8');

    await this.db.query(
      'UPDATE agent_event_executions SET event_count = event_count + 1, last_event_at = $1 WHERE execution_id = $2',
      [new Date().toISOString(), event.executionId],
    );
  }

  async completeExecution(executionId: string, status: 'completed' | 'failed' | 'interrupted', metrics?: {
    model?: string; effectiveMode?: string; effort?: string; fast?: boolean; durationMs?: number; costUsd?: number;
    inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheCreationTokens?: number;
    commentId?: string; deliverableId?: string;
  }): Promise<void> {
    await this.db.query(
      `UPDATE agent_event_executions SET status = $1, completed_at = $2,
       model = COALESCE($3, model), effective_mode = COALESCE($4, effective_mode),
       effort = COALESCE($5, effort), fast_mode = COALESCE($6, fast_mode),
       duration_ms = COALESCE($7, duration_ms), cost_usd = COALESCE($8, cost_usd),
       input_tokens = COALESCE($9, input_tokens), output_tokens = COALESCE($10, output_tokens),
       cache_read_tokens = COALESCE($11, cache_read_tokens), cache_creation_tokens = COALESCE($12, cache_creation_tokens),
       comment_id = COALESCE($13, comment_id), deliverable_id = COALESCE($14, deliverable_id)
       WHERE execution_id = $15`,
      [status, new Date().toISOString(), metrics?.model ?? null, metrics?.effectiveMode ?? null,
       metrics?.effort ?? null, metrics?.fast ?? null,
       metrics?.durationMs ?? null, metrics?.costUsd ?? null, metrics?.inputTokens ?? null,
       metrics?.outputTokens ?? null, metrics?.cacheReadTokens ?? null, metrics?.cacheCreationTokens ?? null,
       metrics?.commentId ?? null, metrics?.deliverableId ?? null, executionId],
    );
  }

  async setExecutionOutputs(executionId: string, refs: { commentId?: string; deliverableId?: string }): Promise<void> {
    await this.db.query(
      `UPDATE agent_event_executions SET
       comment_id = COALESCE($1, comment_id), deliverable_id = COALESCE($2, deliverable_id)
       WHERE execution_id = $3`,
      [refs.commentId ?? null, refs.deliverableId ?? null, executionId],
    );
  }

  async upsertCliExecution(p: CliExecutionUpsert): Promise<void> {
    await this.db.query(
      `INSERT INTO agent_event_executions
        (execution_id, persona_id, ticket_id, mention_id, event_count, status, started_at,
         completed_at, sdk_session_id, model, duration_ms, cost_usd, input_tokens,
         output_tokens, cache_read_tokens, cache_creation_tokens, source)
       VALUES ($1, 'cli', $2, $3, 0, 'completed', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'cli')
       ON CONFLICT (execution_id) DO UPDATE SET
         completed_at = EXCLUDED.completed_at, sdk_session_id = EXCLUDED.sdk_session_id,
         model = EXCLUDED.model, duration_ms = EXCLUDED.duration_ms, cost_usd = EXCLUDED.cost_usd,
         input_tokens = EXCLUDED.input_tokens, output_tokens = EXCLUDED.output_tokens,
         cache_read_tokens = EXCLUDED.cache_read_tokens,
         cache_creation_tokens = EXCLUDED.cache_creation_tokens, source = 'cli'`,
      [p.executionId, p.ticketId, p.mentionId, p.startedAt, p.completedAt, p.sdkSessionId,
       p.model, p.durationMs, p.costUsd, p.inputTokens, p.outputTokens, p.cacheReadTokens,
       p.cacheCreationTokens],
    );
  }

  async getEventsByExecution(executionId: string): Promise<AgentEventEntity[]> {
    const filePath = join(this.eventsDir, `${executionId}.jsonl`);
    if (!existsSync(filePath)) return [];

    const raw = await readFile(filePath, 'utf-8');
    const events: AgentEventEntity[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const dto = JSON.parse(line);
        events.push(new AgentEventEntity(
          dto.id, dto.executionId, dto.eventType,
          dto.data, dto.sequence, new Date(dto.createdAt),
        ));
      } catch {
        // Skip malformed lines
      }
    }
    return events;
  }

  async getExecutionsByTicket(ticketId: string): Promise<AgentExecution[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM agent_event_executions WHERE ticket_id = $1 ORDER BY started_at DESC',
      [ticketId],
    );
    return rows.map(rowToExecution);
  }

  async getExecutionsByPersona(personaId: string, limit = 50): Promise<AgentExecution[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM agent_event_executions WHERE persona_id = $1 ORDER BY started_at DESC LIMIT $2',
      [personaId, limit],
    );
    return rows.map(rowToExecution);
  }

  async getAllExecutions(): Promise<AgentExecution[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM agent_event_executions ORDER BY started_at DESC',
    );
    return rows.map(rowToExecution);
  }

  async updateSessionId(executionId: string, sdkSessionId: string): Promise<void> {
    await this.db.query(
      'UPDATE agent_event_executions SET sdk_session_id = $1 WHERE execution_id = $2',
      [sdkSessionId, executionId],
    );
  }

  async markInterruptedExecutions(): Promise<string[]> {
    const { rows } = await this.db.query(
      "SELECT mention_id FROM agent_event_executions WHERE status = 'running'",
    );
    await this.db.query(
      "UPDATE agent_event_executions SET status = 'interrupted', completed_at = $1 WHERE status = 'running'",
      [new Date().toISOString()],
    );
    return rows.map((r: Record<string, unknown>) => r.mention_id as string);
  }

  async findStaleRunningExecutions(cutoffIso: string): Promise<StaleExecution[]> {
    const { rows } = await this.db.query(
      `SELECT execution_id, persona_id, ticket_id, mention_id,
              COALESCE(last_event_at, started_at) AS last_activity_at
       FROM agent_event_executions
       WHERE status = 'running' AND COALESCE(last_event_at, started_at) < $1`,
      [cutoffIso],
    );
    return (rows as Record<string, unknown>[]).map((r) => ({
      executionId: r.execution_id as string,
      personaId: r.persona_id as string,
      ticketId: r.ticket_id as string,
      mentionId: r.mention_id as string,
      lastActivityAt: r.last_activity_at as string,
    }));
  }

  async getSessionHistory(): Promise<Map<string, { sdkSessionId: string; personaId: string; ticketId: string }>> {
    const { rows } = await this.db.query(
      `SELECT persona_id, ticket_id, sdk_session_id
       FROM agent_event_executions
       WHERE sdk_session_id IS NOT NULL
       ORDER BY started_at DESC`,
    );
    const result = new Map<string, { sdkSessionId: string; personaId: string; ticketId: string }>();
    for (const row of rows as Record<string, unknown>[]) {
      const key = `${row.persona_id}:${row.ticket_id}`;
      if (!result.has(key)) {
        result.set(key, {
          sdkSessionId: row.sdk_session_id as string,
          personaId: row.persona_id as string,
          ticketId: row.ticket_id as string,
        });
      }
    }
    return result;
  }
}

function rowToExecution(row: Record<string, unknown>): AgentExecution {
  return {
    id: row.execution_id as string,
    personaId: row.persona_id as string,
    ticketId: row.ticket_id as string,
    mentionId: row.mention_id as string,
    eventCount: row.event_count as number,
    status: row.status as AgentExecution['status'],
    startedAt: row.started_at as string,
    completedAt: (row.completed_at as string) ?? null,
    lastEventAt: (row.last_event_at as string) ?? null,
    sdkSessionId: (row.sdk_session_id as string) ?? null,
    model: (row.model as string) ?? null,
    effectiveMode: (row.effective_mode as string) ?? null,
    effort: (row.effort as string) ?? null,
    fast: row.fast_mode == null ? null : (row.fast_mode as boolean),
    durationMs: (row.duration_ms as number) ?? null,
    costUsd: (row.cost_usd as number) ?? null,
    inputTokens: (row.input_tokens as number) ?? null,
    outputTokens: (row.output_tokens as number) ?? null,
    cacheReadTokens: (row.cache_read_tokens as number) ?? null,
    cacheCreationTokens: (row.cache_creation_tokens as number) ?? null,
    source: (row.source as AgentExecution['source']) ?? null,
    commentId: (row.comment_id as string) ?? null,
    deliverableId: (row.deliverable_id as string) ?? null,
  };
}
