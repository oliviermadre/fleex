import type { AgentExecution } from '@fleex/shared';
import type { AgentEventEntity } from '../../domain/entities/agent-event.entity.js';
import type { AgentEventStorePort } from '../../application/ports/agent-event-store.port.js';

/**
 * Write-through in-memory cache over any AgentEventStorePort.
 * Hot path (getAllExecutions, getExecutionsByTicket, getExecutionsByPersona)
 * never touches the DB after warmUp.
 */
export class CachedAgentEventStore implements AgentEventStorePort {
  private executions = new Map<string, AgentExecution>();
  private warmedUp = false;

  constructor(private readonly inner: AgentEventStorePort) {}

  async warmUp(): Promise<void> {
    const all = await this.inner.getAllExecutions();
    this.executions.clear();
    for (const e of all) {
      this.executions.set(e.id, e);
    }
    this.warmedUp = true;
  }

  private async ensureWarmed(): Promise<void> {
    if (!this.warmedUp) await this.warmUp();
  }

  // ── Hot-path reads (cache only) ──

  async getAllExecutions(): Promise<AgentExecution[]> {
    await this.ensureWarmed();
    return [...this.executions.values()]
      .sort((a, b) => (b.startedAt > a.startedAt ? 1 : b.startedAt < a.startedAt ? -1 : 0));
  }

  async getExecutionsByTicket(ticketId: string): Promise<AgentExecution[]> {
    await this.ensureWarmed();
    return [...this.executions.values()]
      .filter((e) => e.ticketId === ticketId)
      .sort((a, b) => (b.startedAt > a.startedAt ? 1 : b.startedAt < a.startedAt ? -1 : 0));
  }

  async getExecutionsByPersona(personaId: string, limit = 50): Promise<AgentExecution[]> {
    await this.ensureWarmed();
    return [...this.executions.values()]
      .filter((e) => e.personaId === personaId)
      .sort((a, b) => (b.startedAt > a.startedAt ? 1 : b.startedAt < a.startedAt ? -1 : 0))
      .slice(0, limit);
  }

  // ── Write-through mutations ──

  async startExecution(params: {
    executionId: string;
    personaId: string;
    ticketId: string | null;
    mentionId: string;
  }): Promise<void> {
    await this.inner.startExecution(params);
    this.executions.set(params.executionId, {
      id: params.executionId,
      personaId: params.personaId,
      ticketId: params.ticketId,
      mentionId: params.mentionId,
      eventCount: 0,
      status: 'running',
      startedAt: new Date().toISOString(),
      completedAt: null,
      lastEventAt: null,
      sdkSessionId: null,
      model: null,
      effectiveMode: null,
      durationMs: null,
      costUsd: null,
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      cacheCreationTokens: null,
    });
  }

  async completeExecution(executionId: string, status: 'completed' | 'failed' | 'interrupted', metrics?: {
    model?: string; effectiveMode?: string; durationMs?: number; costUsd?: number;
    inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheCreationTokens?: number;
  }): Promise<void> {
    await this.inner.completeExecution(executionId, status, metrics);
    const cached = this.executions.get(executionId);
    if (cached) {
      this.executions.set(executionId, {
        ...cached,
        status,
        completedAt: new Date().toISOString(),
        ...(metrics?.model != null && { model: metrics.model }),
        ...(metrics?.effectiveMode != null && { effectiveMode: metrics.effectiveMode }),
        ...(metrics?.durationMs != null && { durationMs: metrics.durationMs }),
        ...(metrics?.costUsd != null && { costUsd: metrics.costUsd }),
        ...(metrics?.inputTokens != null && { inputTokens: metrics.inputTokens }),
        ...(metrics?.outputTokens != null && { outputTokens: metrics.outputTokens }),
        ...(metrics?.cacheReadTokens != null && { cacheReadTokens: metrics.cacheReadTokens }),
        ...(metrics?.cacheCreationTokens != null && { cacheCreationTokens: metrics.cacheCreationTokens }),
      });
    }
  }

  async updateSessionId(executionId: string, sdkSessionId: string): Promise<void> {
    await this.inner.updateSessionId(executionId, sdkSessionId);
    const cached = this.executions.get(executionId);
    if (cached) {
      this.executions.set(executionId, { ...cached, sdkSessionId });
    }
  }

  async appendEvent(event: AgentEventEntity): Promise<void> {
    await this.inner.appendEvent(event);
    const cached = this.executions.get(event.executionId);
    if (cached) {
      this.executions.set(event.executionId, {
        ...cached,
        eventCount: cached.eventCount + 1,
        lastEventAt: new Date().toISOString(),
      });
    }
  }

  async markInterruptedExecutions(): Promise<string[]> {
    const mentionIds = await this.inner.markInterruptedExecutions();
    const now = new Date().toISOString();
    for (const [id, exec] of this.executions) {
      if (exec.status === 'running') {
        this.executions.set(id, { ...exec, status: 'interrupted', completedAt: now });
      }
    }
    return mentionIds;
  }

  // ── Passthrough (not on hot path) ──

  async getEventsByExecution(executionId: string): Promise<AgentEventEntity[]> {
    return this.inner.getEventsByExecution(executionId);
  }

  async getSessionHistory(): Promise<Map<string, { sdkSessionId: string; personaId: string; ticketId: string }>> {
    return this.inner.getSessionHistory();
  }
}
