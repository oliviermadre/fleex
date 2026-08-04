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

/** A `running` execution row that has gone quiet past the staleness cutoff. */
export interface StaleExecution {
  executionId: string;
  personaId: string;
  ticketId: string;
  mentionId: string;
  /** Last event timestamp, or the start time when the run never emitted one. */
  lastActivityAt: string;
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
  }): Promise<void>;

  appendEvent(event: AgentEventEntity): Promise<void>;

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

  /** Mark all 'running' executions as 'interrupted'. Returns affected mention IDs. */
  markInterruptedExecutions(): Promise<string[]>;

  /**
   * Executions still flagged `running` that haven't produced an event since
   * `cutoffIso` — i.e. ghost runs whose process died or hung without ever
   * writing a terminal status. Read-only: the caller decides how to reap each
   * one (an in-process run is aborted through the execution registry, a truly
   * orphaned row is closed via `completeExecution`).
   *
   * Rows with no `last_event_at` at all fall back to `started_at`, so an
   * execution that hung before its first event is still reaped.
   */
  findStaleRunningExecutions(cutoffIso: string): Promise<StaleExecution[]>;

  /** Returns a map of "personaId:ticketId" → sdkSessionId from latest executions. */
  getSessionHistory(): Promise<Map<string, { sdkSessionId: string; personaId: string; ticketId: string }>>;

  getEventsByExecution(executionId: string): Promise<AgentEventEntity[]>;

  getExecutionsByTicket(ticketId: string): Promise<AgentExecution[]>;

  getExecutionsByPersona(personaId: string, limit?: number): Promise<AgentExecution[]>;

  getAllExecutions(): Promise<AgentExecution[]>;
}
