import type { AgentExecution } from '@fleex/shared';
import type { AgentEventEntity } from '../../domain/entities/agent-event.entity.js';
import type { AgentEventStorePort, CliExecutionUpsert } from '../../application/ports/agent-event-store.port.js';

/**
 * Write-through in-memory cache over any AgentEventStorePort.
 * Hot path (getAllExecutions, getExecutionsByTicket, getExecutionsByPersona)
 * never touches the DB after warmUp.
 */
export class CachedAgentEventStore implements AgentEventStorePort {
  private executions = new Map<string, AgentExecution>();
  private warmedUp = false;

  /**
   * Fired right after an execution's cached status flips (running → terminal, or
   * into existence). This cache IS the source the cockpit's agent-activity
   * endpoint reads, so a listener notified here is guaranteed to observe the new
   * status — unlike a listener hooked on the `execution_start`/`execution_end`
   * *stream* events, which the use-cases emit before `completeExecution` and
   * before minutes of post-processing (comments, deliverables). That gap is what
   * left the cockpit badge stuck on "Running for 11m" after a finished skill run.
   */
  onExecutionLifecycle?: (e: {
    executionId: string;
    ticketId: string | null;
    status: AgentExecution['status'];
  }) => void;

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
    model?: string;
    effort?: string;
    fast?: boolean;
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
      model: params.model ?? null,
      effectiveMode: null,
      effort: params.effort ?? null,
      fast: params.fast ?? null,
      durationMs: null,
      costUsd: null,
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      cacheCreationTokens: null,
    });
    this.onExecutionLifecycle?.({
      executionId: params.executionId,
      ticketId: params.ticketId,
      status: 'running',
    });
  }

  async completeExecution(executionId: string, status: 'completed' | 'failed' | 'interrupted', metrics?: {
    model?: string; effectiveMode?: string; effort?: string; fast?: boolean; durationMs?: number; costUsd?: number;
    inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheCreationTokens?: number;
    commentId?: string; deliverableId?: string;
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
        ...(metrics?.effort != null && { effort: metrics.effort }),
        ...(metrics?.fast != null && { fast: metrics.fast }),
        ...(metrics?.durationMs != null && { durationMs: metrics.durationMs }),
        ...(metrics?.costUsd != null && { costUsd: metrics.costUsd }),
        ...(metrics?.inputTokens != null && { inputTokens: metrics.inputTokens }),
        ...(metrics?.outputTokens != null && { outputTokens: metrics.outputTokens }),
        ...(metrics?.cacheReadTokens != null && { cacheReadTokens: metrics.cacheReadTokens }),
        ...(metrics?.cacheCreationTokens != null && { cacheCreationTokens: metrics.cacheCreationTokens }),
        ...(metrics?.commentId != null && { commentId: metrics.commentId }),
        ...(metrics?.deliverableId != null && { deliverableId: metrics.deliverableId }),
      });
    }
    this.onExecutionLifecycle?.({
      executionId,
      ticketId: cached?.ticketId ?? null,
      status,
    });
  }

  async setExecutionOutputs(executionId: string, refs: { commentId?: string; deliverableId?: string }): Promise<void> {
    await this.inner.setExecutionOutputs(executionId, refs);
    const cached = this.executions.get(executionId);
    if (cached) {
      this.executions.set(executionId, {
        ...cached,
        ...(refs.commentId != null && { commentId: refs.commentId }),
        ...(refs.deliverableId != null && { deliverableId: refs.deliverableId }),
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

  async upsertCliExecution(p: CliExecutionUpsert): Promise<void> {
    await this.inner.upsertCliExecution(p);
    this.executions.set(p.executionId, {
      id: p.executionId,
      personaId: 'cli',
      ticketId: p.ticketId,
      mentionId: p.mentionId,
      eventCount: 0,
      status: 'completed',
      startedAt: p.startedAt,
      completedAt: p.completedAt,
      lastEventAt: null,
      sdkSessionId: p.sdkSessionId,
      model: p.model,
      effectiveMode: null,
      effort: null,
      fast: null,
      durationMs: p.durationMs,
      costUsd: p.costUsd,
      inputTokens: p.inputTokens,
      outputTokens: p.outputTokens,
      cacheReadTokens: p.cacheReadTokens,
      cacheCreationTokens: p.cacheCreationTokens,
      source: 'cli',
    });
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
        // A restart orphans in-flight runs. Without this the cockpit keeps a
        // "Running for …" badge alive for an execution nothing will ever finish.
        this.onExecutionLifecycle?.({ executionId: id, ticketId: exec.ticketId, status: 'interrupted' });
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
