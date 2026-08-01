import { join } from 'node:path';
import { appendFile, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { FLEEX_DIR } from '@fleex/shared';
import type { AgentExecution } from '@fleex/shared';
import { AgentEventEntity } from '../../../domain/entities/agent-event.entity.js';
import type { AgentEventStorePort, CliExecutionUpsert, SessionHistoryRow } from '../../../application/ports/agent-event-store.port.js';
import type { SupabaseConnection } from './connection.js';

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
  fast_mode: boolean | null;
  duration_ms: number | null;
  cost_usd: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_creation_tokens: number | null;
  source: string | null;
  comment_id: string | null;
  deliverable_id: string | null;
}

export class SupabaseAgentEventStore implements AgentEventStorePort {
  private readonly eventsDir: string;

  constructor(private readonly conn: SupabaseConnection) {
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
    const { error } = await this.conn.client.from('agent_event_executions').insert({
      execution_id: params.executionId,
      persona_id: params.personaId,
      ticket_id: params.ticketId,
      mention_id: params.mentionId,
      event_count: 0,
      status: 'running',
      started_at: new Date().toISOString(),
      model: params.model ?? null,
      effort: params.effort ?? null,
      fast_mode: params.fast ?? null,
    });
    if (error) throw new Error(`SupabaseAgentEventStore.startExecution failed: ${error.message}`);
  }

  async appendEvent(event: AgentEventEntity): Promise<void> {
    const filePath = join(this.eventsDir, `${event.executionId}.jsonl`);
    const line = JSON.stringify(event.toDTO()) + '\n';
    await appendFile(filePath, line, 'utf-8');

    // Increment event count and update last_event_at
    const { data, error: readErr } = await this.conn.client
      .from('agent_event_executions')
      .select('event_count')
      .eq('execution_id', event.executionId)
      .single();

    if (!readErr && data) {
      await this.conn.client
        .from('agent_event_executions')
        .update({
          event_count: (data as { event_count: number }).event_count + 1,
          last_event_at: new Date().toISOString(),
        })
        .eq('execution_id', event.executionId);
    }
  }

  async completeExecution(executionId: string, status: 'completed' | 'failed' | 'interrupted', metrics?: {
    model?: string; effectiveMode?: string; effort?: string; fast?: boolean; durationMs?: number; costUsd?: number;
    inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheCreationTokens?: number;
    commentId?: string; deliverableId?: string;
  }): Promise<void> {
    const update: Record<string, unknown> = { status, completed_at: new Date().toISOString() };
    if (metrics?.model) update.model = metrics.model;
    if (metrics?.effectiveMode) update.effective_mode = metrics.effectiveMode;
    if (metrics?.effort) update.effort = metrics.effort;
    if (metrics?.fast != null) update.fast_mode = metrics.fast;
    if (metrics?.durationMs != null) update.duration_ms = metrics.durationMs;
    if (metrics?.costUsd != null) update.cost_usd = metrics.costUsd;
    if (metrics?.inputTokens != null) update.input_tokens = metrics.inputTokens;
    if (metrics?.outputTokens != null) update.output_tokens = metrics.outputTokens;
    if (metrics?.cacheReadTokens != null) update.cache_read_tokens = metrics.cacheReadTokens;
    if (metrics?.cacheCreationTokens != null) update.cache_creation_tokens = metrics.cacheCreationTokens;
    if (metrics?.commentId != null) update.comment_id = metrics.commentId;
    if (metrics?.deliverableId != null) update.deliverable_id = metrics.deliverableId;
    const { error } = await this.conn.client
      .from('agent_event_executions')
      .update(update)
      .eq('execution_id', executionId);
    if (error) throw new Error(`SupabaseAgentEventStore.completeExecution failed: ${error.message}`);
  }

  async setExecutionOutputs(executionId: string, refs: { commentId?: string; deliverableId?: string }): Promise<void> {
    const update: Record<string, unknown> = {};
    if (refs.commentId != null) update.comment_id = refs.commentId;
    if (refs.deliverableId != null) update.deliverable_id = refs.deliverableId;
    if (Object.keys(update).length === 0) return;
    const { error } = await this.conn.client
      .from('agent_event_executions')
      .update(update)
      .eq('execution_id', executionId);
    if (error) throw new Error(`SupabaseAgentEventStore.setExecutionOutputs failed: ${error.message}`);
  }

  async upsertCliExecution(p: CliExecutionUpsert): Promise<void> {
    const { error } = await this.conn.client
      .from('agent_event_executions')
      .upsert({
        execution_id: p.executionId,
        persona_id: 'cli',
        ticket_id: p.ticketId,
        mention_id: p.mentionId,
        event_count: 0,
        status: 'completed',
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
        source: 'cli',
      }, { onConflict: 'execution_id' });
    if (error) throw new Error(`SupabaseAgentEventStore.upsertCliExecution failed: ${error.message}`);
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

  async getExecutionById(executionId: string): Promise<AgentExecution | null> {
    const { data, error } = await this.conn.client
      .from('agent_event_executions')
      .select('*')
      .eq('execution_id', executionId)
      .maybeSingle();
    if (error) throw new Error(`SupabaseAgentEventStore.getExecutionById failed: ${error.message}`);
    return data ? rowToExecution(data as ExecutionRow) : null;
  }

  async getExecutionsByTicket(ticketId: string): Promise<AgentExecution[]> {
    const { data, error } = await this.conn.client
      .from('agent_event_executions')
      .select('*')
      .eq('ticket_id', ticketId)
      .order('started_at', { ascending: false });
    if (error) throw new Error(`SupabaseAgentEventStore.getExecutionsByTicket failed: ${error.message}`);
    return (data as ExecutionRow[]).map(rowToExecution);
  }

  async getExecutionsByPersona(personaId: string, limit = 50): Promise<AgentExecution[]> {
    const { data, error } = await this.conn.client
      .from('agent_event_executions')
      .select('*')
      .eq('persona_id', personaId)
      .order('started_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(`SupabaseAgentEventStore.getExecutionsByPersona failed: ${error.message}`);
    return (data as ExecutionRow[]).map(rowToExecution);
  }

  async getAllExecutions(): Promise<AgentExecution[]> {
    const { data, error } = await this.conn.client
      .from('agent_event_executions')
      .select('*')
      .order('started_at', { ascending: false });
    if (error) throw new Error(`SupabaseAgentEventStore.getAllExecutions failed: ${error.message}`);
    return (data as ExecutionRow[]).map(rowToExecution);
  }

  async updateSessionId(executionId: string, sdkSessionId: string): Promise<void> {
    const { error } = await this.conn.client
      .from('agent_event_executions')
      .update({ sdk_session_id: sdkSessionId })
      .eq('execution_id', executionId);
    if (error) throw new Error(`SupabaseAgentEventStore.updateSessionId failed: ${error.message}`);
  }

  async markInterruptedExecutions(): Promise<string[]> {
    const { data: running, error: readErr } = await this.conn.client
      .from('agent_event_executions')
      .select('mention_id')
      .eq('status', 'running');
    if (readErr) throw new Error(`SupabaseAgentEventStore.markInterruptedExecutions read failed: ${readErr.message}`);

    const mentionIds = (running as { mention_id: string }[]).map((r) => r.mention_id);

    if (mentionIds.length > 0) {
      const { error } = await this.conn.client
        .from('agent_event_executions')
        .update({ status: 'interrupted', completed_at: new Date().toISOString() })
        .eq('status', 'running');
      if (error) throw new Error(`SupabaseAgentEventStore.markInterruptedExecutions update failed: ${error.message}`);
    }

    return mentionIds;
  }

  async getSessionHistory(): Promise<SessionHistoryRow[]> {
    const { data, error } = await this.conn.client
      .from('agent_event_executions')
      .select('persona_id, ticket_id, mention_id, sdk_session_id, status')
      .not('sdk_session_id', 'is', null)
      .order('started_at', { ascending: false });
    if (error) throw new Error(`SupabaseAgentEventStore.getSessionHistory failed: ${error.message}`);

    return (data as {
      persona_id: string; ticket_id: string; mention_id: string;
      sdk_session_id: string; status: string;
    }[]).map((row) => ({
      sdkSessionId: row.sdk_session_id,
      personaId: row.persona_id,
      ticketId: row.ticket_id,
      mentionId: row.mention_id,
      status: row.status as SessionHistoryRow['status'],
    }));
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
    fast: row.fast_mode ?? null,
    durationMs: row.duration_ms ?? null,
    costUsd: row.cost_usd ?? null,
    inputTokens: row.input_tokens ?? null,
    outputTokens: row.output_tokens ?? null,
    cacheReadTokens: row.cache_read_tokens ?? null,
    cacheCreationTokens: row.cache_creation_tokens ?? null,
    source: (row.source as AgentExecution['source']) ?? null,
    commentId: row.comment_id ?? null,
    deliverableId: row.deliverable_id ?? null,
  };
}
