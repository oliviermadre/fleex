import type { AgentExecution } from '@fleex/shared';
import type { AgentEventEntity } from '../../domain/entities/agent-event.entity.js';

/** Params for `upsertCliExecution` — a fully-computed CLI session execution row. */
export interface CliExecutionUpsert {
  executionId: string;
  sdkSessionId: string;
  ticketId: string;
  mentionId: string;
  model: string | null;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  costUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheCreationTokens: number | null;
}

export interface AgentEventStorePort {
  startExecution(params: {
    executionId: string;
    personaId: string;
    ticketId: string;
    mentionId: string;
    /**
     * The model that will run this execution (conversation override or persona
     * default). Recorded up-front so cost tracking / the audit trail know which
     * model ran even if the execution is cancelled or crashes before completion.
     */
    model?: string;
    /** Resolved reasoning effort (if the model supports it), recorded up-front. */
    effort?: string;
    /** Resolved fast/low-latency mode (if the model supports it), recorded up-front. */
    fast?: boolean;
    /**
     * The instance that owns this run. Recorded up-front because it decides who
     * may cancel it and whose startup sweep may reclaim it — see
     * `markInterruptedExecutions`.
     */
    instanceId?: string;
    /** Human-facing hostname of `instanceId`, for the "runs on …" chip. */
    instanceLabel?: string;
  }): Promise<void>;

  appendEvent(event: AgentEventEntity): Promise<void>;

  /**
   * Persist agent events that were streamed by *another* instance and relayed to
   * us over the hub, so the local event-history endpoint can replay them.
   *
   * Deliberately not `appendEvent`: `event_count` / `last_event_at` on the
   * execution row belong to the originator, and bumping them here would
   * double-count in shared storage. Batched because a backfill response arrives
   * as hundreds of events at once.
   */
  mirrorRemoteEvents(events: AgentEventEntity[]): Promise<void>;

  completeExecution(executionId: string, status: 'completed' | 'failed' | 'interrupted', metrics?: {
    model?: string;
    effectiveMode?: string;
    effort?: string;
    fast?: boolean;
    durationMs?: number;
    costUsd?: number;
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
    /** Comment produced by this run (persona/skill/panel path, known at completion). */
    commentId?: string;
    /** Deliverable produced by this run (persona/skill/panel path, known at completion). */
    deliverableId?: string;
  }): Promise<void>;

  /**
   * Link an already-completed execution to the artifacts it produced. Used by the
   * workflow-step path, where the execution completes inside `execute-agent`
   * (returning only its structured output) and the orchestrator persists the
   * comment/deliverable afterwards. No-op if `executionId` doesn't exist.
   */
  setExecutionOutputs(executionId: string, refs: { commentId?: string; deliverableId?: string }): Promise<void>;

  updateSessionId(executionId: string, sdkSessionId: string): Promise<void>;

  /**
   * Insert (or refresh) a CLI-origin execution ingested from a Claude transcript.
   * Idempotent on `executionId` (caller uses a stable `cli:<sessionId>` key) and
   * tagged `source='cli'`. Never produced by the agentic loop — only by the CLI
   * session ingestion (real-time SessionEnd hook + backfill script).
   */
  upsertCliExecution(params: CliExecutionUpsert): Promise<void>;

  /**
   * Mark this instance's orphaned 'running' executions as 'interrupted'. Returns
   * affected mention IDs.
   *
   * Scoped to `instanceId`: with shared storage a sibling instance's runs are
   * live rows in the same table, and an unscoped sweep would kill them (and
   * re-trigger their mentions) on every boot.
   */
  markInterruptedExecutions(instanceId: string): Promise<string[]>;

  /** Returns a map of "personaId:ticketId" → sdkSessionId from latest executions. */
  getSessionHistory(): Promise<Map<string, { sdkSessionId: string; personaId: string; ticketId: string }>>;

  getEventsByExecution(executionId: string): Promise<AgentEventEntity[]>;

  getExecutionsByTicket(ticketId: string): Promise<AgentExecution[]>;

  getExecutionsByPersona(personaId: string, limit?: number): Promise<AgentExecution[]>;

  getAllExecutions(): Promise<AgentExecution[]>;

  /**
   * Read a single execution straight from the source of truth. Used by the
   * write-through cache to re-read a row a sibling instance just wrote, rather
   * than serving a stale entry.
   */
  getExecutionById(executionId: string): Promise<AgentExecution | null>;
}
