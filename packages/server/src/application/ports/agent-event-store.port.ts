import type { AgentExecution } from '@fleex/shared';
import type { AgentEventEntity } from '../../domain/entities/agent-event.entity.js';
import type { CostBasis, SdkSessionBaseline, SdkUsageTotals } from '../utils/sdk-run-usage.js';

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
    ticketId: string | null;
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
    /**
     * Raw usage the SDK reported for this run (a running session total on a
     * carrying CLI). `costUsd`/tokens above are this run's share; the raw values
     * are the baseline the next resumed run of the session is measured against.
     */
    sdkTotals?: SdkUsageTotals;
    /** Claude Code CLI version that produced the run (from the SDK `init` message). */
    cliVersion?: string;
    /** How `costUsd` must be read — see `CostBasis`. */
    costBasis?: CostBasis;
  }): Promise<void>;

  /**
   * Earlier executions of `sdkSessionId` other than `executionId`: how many, and
   * the raw totals + CLI version of the latest one that saw spend.
   */
  getSdkSessionBaseline(sdkSessionId: string, executionId: string): Promise<SdkSessionBaseline>;

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

  /** Returns a map of "personaId:ticketId" → sdkSessionId from latest executions. */
  getSessionHistory(): Promise<Map<string, { sdkSessionId: string; personaId: string; ticketId: string }>>;

  getEventsByExecution(executionId: string): Promise<AgentEventEntity[]>;

  getExecutionsByTicket(ticketId: string): Promise<AgentExecution[]>;

  getExecutionsByPersona(personaId: string, limit?: number): Promise<AgentExecution[]>;

  getAllExecutions(): Promise<AgentExecution[]>;
}
