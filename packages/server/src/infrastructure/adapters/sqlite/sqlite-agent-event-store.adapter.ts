import { join } from 'node:path';
import { appendFile, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { FLEEX_DIR } from '@fleex/shared';
import type { AgentExecution } from '@fleex/shared';
import { AgentEventEntity } from '../../../domain/entities/agent-event.entity.js';
import type { AgentEventStorePort, CliExecutionUpsert } from '../../../application/ports/agent-event-store.port.js';
import type { SqliteConnection } from './connection.js';

interface ExecutionRow {
  execution_id: string;
  persona_id: string;
  ticket_id: string;
  mention_id: string;
  event_count: number;
  status: string;
  started_at: string;
  completed_at: string | null;
  sdk_session_id: string | null;
  last_event_at: string | null;
  model: string | null;
  effective_mode: string | null;
  effort: string | null;
  fast_mode: number | null;
  duration_ms: number | null;
  cost_usd: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_creation_tokens: number | null;
  source: string | null;
}

export class SqliteAgentEventStoreAdapter implements AgentEventStorePort {
  private readonly eventsDir: string;

  constructor(private readonly conn: SqliteConnection) {
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
    this.conn.db.prepare(`
      INSERT INTO agent_event_executions
        (execution_id, persona_id, ticket_id, mention_id, event_count, status, started_at, model, effort, fast_mode)
      VALUES (@execution_id, @persona_id, @ticket_id, @mention_id, 0, 'running', @started_at, @model, @effort, @fast_mode)
    `).run({
      execution_id: params.executionId,
      persona_id: params.personaId,
      ticket_id: params.ticketId,
      mention_id: params.mentionId,
      started_at: new Date().toISOString(),
      model: params.model ?? null,
      effort: params.effort ?? null,
      fast_mode: params.fast == null ? null : params.fast ? 1 : 0,
    });
  }

  async appendEvent(event: AgentEventEntity): Promise<void> {
    const filePath = join(this.eventsDir, `${event.executionId}.jsonl`);
    const line = JSON.stringify(event.toDTO()) + '\n';
    await appendFile(filePath, line, 'utf-8');

    this.conn.db.prepare(
      'UPDATE agent_event_executions SET event_count = event_count + 1, last_event_at = ? WHERE execution_id = ?'
    ).run(new Date().toISOString(), event.executionId);
  }

  async completeExecution(executionId: string, status: 'completed' | 'failed' | 'interrupted', metrics?: {
    model?: string; effectiveMode?: string; effort?: string; fast?: boolean; durationMs?: number; costUsd?: number;
    inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheCreationTokens?: number;
  }): Promise<void> {
    this.conn.db.prepare(
      `UPDATE agent_event_executions SET status = ?, completed_at = ?,
       model = COALESCE(?, model),
       effective_mode = COALESCE(?, effective_mode),
       effort = COALESCE(?, effort),
       fast_mode = COALESCE(?, fast_mode),
       duration_ms = COALESCE(?, duration_ms),
       cost_usd = COALESCE(?, cost_usd),
       input_tokens = COALESCE(?, input_tokens),
       output_tokens = COALESCE(?, output_tokens),
       cache_read_tokens = COALESCE(?, cache_read_tokens),
       cache_creation_tokens = COALESCE(?, cache_creation_tokens)
       WHERE execution_id = ?`
    ).run(
      status, new Date().toISOString(),
      metrics?.model ?? null,
      metrics?.effectiveMode ?? null,
      metrics?.effort ?? null,
      metrics?.fast == null ? null : metrics.fast ? 1 : 0,
      metrics?.durationMs ?? null,
      metrics?.costUsd ?? null,
      metrics?.inputTokens ?? null,
      metrics?.outputTokens ?? null,
      metrics?.cacheReadTokens ?? null,
      metrics?.cacheCreationTokens ?? null,
      executionId,
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
    const rows = this.conn.db
      .prepare('SELECT * FROM agent_event_executions WHERE ticket_id = ? ORDER BY started_at DESC')
      .all(ticketId) as ExecutionRow[];
    return rows.map(rowToExecution);
  }

  async getExecutionsByPersona(personaId: string, limit = 50): Promise<AgentExecution[]> {
    const rows = this.conn.db
      .prepare('SELECT * FROM agent_event_executions WHERE persona_id = ? ORDER BY started_at DESC LIMIT ?')
      .all(personaId, limit) as ExecutionRow[];
    return rows.map(rowToExecution);
  }

  async getAllExecutions(): Promise<AgentExecution[]> {
    const rows = this.conn.db
      .prepare('SELECT * FROM agent_event_executions ORDER BY started_at DESC')
      .all() as ExecutionRow[];
    return rows.map(rowToExecution);
  }

  async updateSessionId(executionId: string, sdkSessionId: string): Promise<void> {
    this.conn.db.prepare(
      'UPDATE agent_event_executions SET sdk_session_id = ? WHERE execution_id = ?'
    ).run(sdkSessionId, executionId);
  }

  async upsertCliExecution(p: CliExecutionUpsert): Promise<void> {
    this.conn.db.prepare(`
      INSERT INTO agent_event_executions
        (execution_id, persona_id, ticket_id, mention_id, event_count, status, started_at,
         completed_at, sdk_session_id, model, duration_ms, cost_usd, input_tokens,
         output_tokens, cache_read_tokens, cache_creation_tokens, source)
      VALUES (@execution_id, 'cli', @ticket_id, @mention_id, 0, 'completed', @started_at,
         @completed_at, @sdk_session_id, @model, @duration_ms, @cost_usd, @input_tokens,
         @output_tokens, @cache_read_tokens, @cache_creation_tokens, 'cli')
      ON CONFLICT(execution_id) DO UPDATE SET
        completed_at = excluded.completed_at, sdk_session_id = excluded.sdk_session_id,
        model = excluded.model, duration_ms = excluded.duration_ms, cost_usd = excluded.cost_usd,
        input_tokens = excluded.input_tokens, output_tokens = excluded.output_tokens,
        cache_read_tokens = excluded.cache_read_tokens,
        cache_creation_tokens = excluded.cache_creation_tokens, source = 'cli'
    `).run({
      execution_id: p.executionId,
      ticket_id: p.ticketId,
      mention_id: p.mentionId,
      started_at: p.startedAt,
      completed_at: p.completedAt,
      sdk_session_id: p.sdkSessionId,
      model: p.model,
      duration_ms: p.durationMs,
      cost_usd: p.costUsd,
      input_tokens: p.inputTokens,
      output_tokens: p.outputTokens,
      cache_read_tokens: p.cacheReadTokens,
      cache_creation_tokens: p.cacheCreationTokens,
    });
  }

  async markInterruptedExecutions(): Promise<string[]> {
    const rows = this.conn.db
      .prepare("SELECT mention_id FROM agent_event_executions WHERE status = 'running'")
      .all() as { mention_id: string }[];

    this.conn.db.prepare(
      "UPDATE agent_event_executions SET status = 'interrupted', completed_at = ? WHERE status = 'running'"
    ).run(new Date().toISOString());

    return rows.map((r) => r.mention_id);
  }

  async getSessionHistory(): Promise<Map<string, { sdkSessionId: string; personaId: string; ticketId: string }>> {
    const rows = this.conn.db
      .prepare(`
        SELECT persona_id, ticket_id, sdk_session_id
        FROM agent_event_executions
        WHERE sdk_session_id IS NOT NULL
        ORDER BY started_at DESC
      `)
      .all() as { persona_id: string; ticket_id: string; sdk_session_id: string }[];

    const result = new Map<string, { sdkSessionId: string; personaId: string; ticketId: string }>();
    for (const row of rows) {
      const key = `${row.persona_id}:${row.ticket_id}`;
      if (!result.has(key)) {
        result.set(key, { sdkSessionId: row.sdk_session_id, personaId: row.persona_id, ticketId: row.ticket_id });
      }
    }
    return result;
  }
}

function rowToExecution(row: ExecutionRow): AgentExecution {
  return {
    id: row.execution_id,
    personaId: row.persona_id,
    ticketId: row.ticket_id,
    mentionId: row.mention_id,
    eventCount: row.event_count,
    status: row.status as AgentExecution['status'],
    startedAt: row.started_at,
    completedAt: row.completed_at,
    lastEventAt: row.last_event_at ?? null,
    sdkSessionId: row.sdk_session_id,
    model: row.model ?? null,
    effectiveMode: row.effective_mode ?? null,
    effort: row.effort ?? null,
    fast: row.fast_mode == null ? null : !!row.fast_mode,
    durationMs: row.duration_ms ?? null,
    costUsd: row.cost_usd ?? null,
    inputTokens: row.input_tokens ?? null,
    outputTokens: row.output_tokens ?? null,
    cacheReadTokens: row.cache_read_tokens ?? null,
    cacheCreationTokens: row.cache_creation_tokens ?? null,
    source: (row.source as AgentExecution['source']) ?? null,
  };
}
