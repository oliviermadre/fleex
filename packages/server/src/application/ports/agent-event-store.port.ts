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

/**
 * One session-bearing execution, as returned by `getSessionHistory`.
 *
 * Adapters return raw rows on purpose: mapping a row onto a session *lineage*
 * requires interpreting the overloaded `mentionId` column (bare uuid = mention,
 * `skill:<id>` = skill, `workflow:<id>` = workflow step), and that rule lives in
 * exactly one place — `lineageKeyForExecution` — instead of being re-implemented
 * in four SQL dialects.
 */
export interface SessionHistoryRow {
  sdkSessionId: string;
  personaId: string;
  ticketId: string;
  mentionId: string;
  status: 'running' | 'completed' | 'failed' | 'interrupted';
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
   * Every execution that carries an SDK session id, most recent first.
   *
   * Returns rows rather than a pre-keyed map so the caller can bucket them per
   * *lineage* (see `session-lineage.ts`). The previous map was keyed on
   * `personaId:ticketId` with no regard for the kind of execution, so after a
   * restart the most recent run of ANY kind won — letting a persona mention
   * resume a skill's or a workflow step's session on the same ticket.
   */
  getSessionHistory(): Promise<SessionHistoryRow[]>;

  getEventsByExecution(executionId: string): Promise<AgentEventEntity[]>;

  /**
   * Single execution by primary key. Used to walk `step_run.executionId →
   * execution.sdkSessionId` when retrying a failed workflow step, which is what
   * lets the retry resume instead of restarting cold.
   */
  getExecutionById(executionId: string): Promise<AgentExecution | null>;

  getExecutionsByTicket(ticketId: string): Promise<AgentExecution[]>;

  getExecutionsByPersona(personaId: string, limit?: number): Promise<AgentExecution[]>;

  getAllExecutions(): Promise<AgentExecution[]>;
}
