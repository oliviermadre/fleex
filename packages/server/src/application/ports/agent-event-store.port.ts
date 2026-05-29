import type { AgentExecution, ExecutionSource } from '@fleex/shared';
import type { AgentEventEntity } from '../../domain/entities/agent-event.entity.js';

export interface AgentEventStorePort {
  startExecution(params: {
    executionId: string;
    personaId: string;
    ticketId: string;
    mentionId: string;
    /** Defaults to 'agent'. Use 'manual' for human-driven Claude Code sessions. */
    source?: ExecutionSource;
  }): Promise<void>;

  appendEvent(event: AgentEventEntity): Promise<void>;

  completeExecution(executionId: string, status: 'completed' | 'failed' | 'interrupted', metrics?: {
    model?: string;
    effectiveMode?: string;
    durationMs?: number;
    costUsd?: number;
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
  }): Promise<void>;

  updateSessionId(executionId: string, sdkSessionId: string): Promise<void>;

  /** Mark all 'running' executions as 'interrupted'. Returns affected mention IDs. */
  markInterruptedExecutions(): Promise<string[]>;

  /** Returns a map of "personaId:ticketId" → sdkSessionId from latest executions. */
  getSessionHistory(): Promise<Map<string, { sdkSessionId: string; personaId: string; ticketId: string }>>;

  getEventsByExecution(executionId: string): Promise<AgentEventEntity[]>;

  getExecutionsByTicket(ticketId: string): Promise<AgentExecution[]>;

  getExecutionsByPersona(personaId: string, limit?: number): Promise<AgentExecution[]>;

  getAllExecutions(): Promise<AgentExecution[]>;
}
