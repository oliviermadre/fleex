import { join } from 'node:path';
import { appendFile, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { FLEEX_DIR } from '@fleex/shared';
import type { AgentExecution } from '@fleex/shared';
import { AgentEventEntity } from '../../../domain/entities/agent-event.entity.js';
import type { AgentEventStorePort } from '../../../application/ports/agent-event-store.port.js';
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
    ticketId: string | null;
    mentionId: string;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO agent_event_executions
        (execution_id, persona_id, ticket_id, mention_id, event_count, status, started_at)
       VALUES ($1, $2, $3, $4, 0, 'running', $5)`,
      [params.executionId, params.personaId, params.ticketId ?? null, params.mentionId, new Date().toISOString()],
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
    model?: string; effectiveMode?: string; durationMs?: number; costUsd?: number;
    inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheCreationTokens?: number;
  }): Promise<void> {
    await this.db.query(
      `UPDATE agent_event_executions SET status = $1, completed_at = $2,
       model = COALESCE($3, model), effective_mode = COALESCE($4, effective_mode),
       duration_ms = COALESCE($5, duration_ms), cost_usd = COALESCE($6, cost_usd),
       input_tokens = COALESCE($7, input_tokens), output_tokens = COALESCE($8, output_tokens),
       cache_read_tokens = COALESCE($9, cache_read_tokens), cache_creation_tokens = COALESCE($10, cache_creation_tokens)
       WHERE execution_id = $11`,
      [status, new Date().toISOString(), metrics?.model ?? null, metrics?.effectiveMode ?? null,
       metrics?.durationMs ?? null, metrics?.costUsd ?? null, metrics?.inputTokens ?? null,
       metrics?.outputTokens ?? null, metrics?.cacheReadTokens ?? null, metrics?.cacheCreationTokens ?? null, executionId],
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

  async getSessionHistory(): Promise<Map<string, { sdkSessionId: string; personaId: string; ticketId: string }>> {
    const { rows } = await this.db.query(
      `SELECT persona_id, ticket_id, sdk_session_id
       FROM agent_event_executions
       WHERE sdk_session_id IS NOT NULL
       ORDER BY started_at DESC`,
    );
    const result = new Map<string, { sdkSessionId: string; personaId: string; ticketId: string }>();
    for (const row of rows as Record<string, unknown>[]) {
      // Ticket-keyed session resume only applies to ticket-bound executions.
      if (!row.ticket_id) continue;
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
    ticketId: (row.ticket_id as string | null) ?? null,
    mentionId: row.mention_id as string,
    eventCount: row.event_count as number,
    status: row.status as AgentExecution['status'],
    startedAt: row.started_at as string,
    completedAt: (row.completed_at as string) ?? null,
    lastEventAt: (row.last_event_at as string) ?? null,
    sdkSessionId: (row.sdk_session_id as string) ?? null,
    model: (row.model as string) ?? null,
    effectiveMode: (row.effective_mode as string) ?? null,
    durationMs: (row.duration_ms as number) ?? null,
    costUsd: (row.cost_usd as number) ?? null,
    inputTokens: (row.input_tokens as number) ?? null,
    outputTokens: (row.output_tokens as number) ?? null,
    cacheReadTokens: (row.cache_read_tokens as number) ?? null,
    cacheCreationTokens: (row.cache_creation_tokens as number) ?? null,
  };
}
