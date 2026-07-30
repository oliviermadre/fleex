import type { AgentExecution } from '@fleex/shared';
import type { AgentEventEntity } from '../../domain/entities/agent-event.entity.js';
import type { AgentEventStorePort, CliExecutionUpsert } from '../../application/ports/agent-event-store.port.js';
import type { RemoteCacheSync } from '../../application/ports/remote-cache-sync.port.js';
import { resolveInstanceIdentity, type InstanceIdentity } from '../../application/services/instance-identity.js';
import type { AnyDomainEvent } from '../../domain/events.js';

/**
 * Write-through in-memory cache over any AgentEventStorePort.
 * Hot path (getAllExecutions, getExecutionsByTicket, getExecutionsByPersona)
 * never touches the DB after warmUp.
 *
 * Implements `RemoteCacheSync` because with shared storage a sibling instance's
 * runs land in the same table without ever passing through this cache. Until it
 * did, `GET /api/executions` on instance B never showed instance A's runs — not
 * even after a page reload, only after a restart re-ran `warmUp`.
 */
export class CachedAgentEventStore implements AgentEventStorePort, RemoteCacheSync {
  private executions = new Map<string, AgentExecution>();
  private warmedUp = false;

  /**
   * Every execution-creating path (persona, skill, workflow step, panel member,
   * panel orchestrator) funnels through this wrapper, so stamping ownership here
   * — rather than at the five call sites — means no path can forget to.
   */
  private readonly instance: InstanceIdentity;

  constructor(
    private readonly inner: AgentEventStorePort,
    instance: InstanceIdentity = resolveInstanceIdentity(),
  ) {
    this.instance = instance;
  }

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

  // ── Cross-instance cache coherence ──

  /**
   * Re-read one execution from the source store, adding, updating or evicting the
   * cached entry. Called when a sibling instance signals that it touched this row
   * (relayed agent event, or a domain event referencing it).
   */
  async refreshExecution(executionId: string): Promise<void> {
    const fresh = await this.inner.getExecutionById(executionId);
    if (fresh) this.executions.set(executionId, fresh);
    else this.executions.delete(executionId);
  }

  /**
   * Domain-event path (`RemoteCacheSync`). Execution rows are mostly refreshed
   * from relayed *agent* events, which don't travel on the domain bus — these two
   * are the domain events that also mutate an execution's terminal state.
   */
  async applyRemoteEvent(event: AnyDomainEvent): Promise<void> {
    if (!this.warmedUp) return; // warmUp will read the sibling's write anyway
    if (event.type === 'execution.cancelled') {
      await this.refreshExecution(event.executionId);
      return;
    }
    if (event.type === 'mention.execution_failed') {
      const affected = [...this.executions.values()].filter((e) => e.mentionId === event.mentionId);
      for (const exec of affected) await this.refreshExecution(exec.id);
    }
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
    ticketId: string;
    mentionId: string;
    model?: string;
    effort?: string;
    fast?: boolean;
    instanceId?: string;
    instanceLabel?: string;
  }): Promise<void> {
    const owned = {
      ...params,
      instanceId: params.instanceId ?? this.instance.id,
      instanceLabel: params.instanceLabel ?? this.instance.label,
    };
    await this.inner.startExecution(owned);
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
      instanceId: owned.instanceId,
      instanceLabel: owned.instanceLabel,
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

  async markInterruptedExecutions(instanceId: string): Promise<string[]> {
    const mentionIds = await this.inner.markInterruptedExecutions(instanceId);
    const now = new Date().toISOString();
    for (const [id, exec] of this.executions) {
      // Mirror the store's instance predicate: a sibling's running row stays
      // running in our cache too, otherwise the UI would show it as interrupted.
      if (exec.status === 'running' && exec.instanceId === instanceId) {
        this.executions.set(id, { ...exec, status: 'interrupted', completedAt: now });
      }
    }
    return mentionIds;
  }

  // ── Passthrough (not on hot path) ──

  async getEventsByExecution(executionId: string): Promise<AgentEventEntity[]> {
    return this.inner.getEventsByExecution(executionId);
  }

  async getExecutionById(executionId: string): Promise<AgentExecution | null> {
    return this.inner.getExecutionById(executionId);
  }

  async mirrorRemoteEvents(events: AgentEventEntity[]): Promise<void> {
    // No cache impact: mirrored events belong to a sibling's run, and its
    // `eventCount` / `lastEventAt` arrive via `refreshExecution`.
    return this.inner.mirrorRemoteEvents(events);
  }

  async getSessionHistory(): Promise<Map<string, { sdkSessionId: string; personaId: string; ticketId: string }>> {
    return this.inner.getSessionHistory();
  }
}
