import type { AgentExecution } from '@fleex/shared';
import type { AgentEventEntity } from '../../domain/entities/agent-event.entity.js';

export interface AgentEventStorePort {
  startExecution(params: {
    executionId: string;
    personaId: string;
    ticketId: string;
    mentionId: string;
  }): Promise<void>;

  appendEvent(event: AgentEventEntity): Promise<void>;

  completeExecution(executionId: string, status: 'completed' | 'failed' | 'interrupted'): Promise<void>;

  updateSessionId(executionId: string, sdkSessionId: string): Promise<void>;

  /** Mark all 'running' executions as 'interrupted'. Returns affected mention IDs. */
  markInterruptedExecutions(): Promise<string[]>;

  /** Returns a map of "personaId:ticketId" → sdkSessionId from latest executions. */
  getSessionHistory(): Promise<Map<string, { sdkSessionId: string; personaId: string; ticketId: string }>>;

  getEventsByExecution(executionId: string): Promise<AgentEventEntity[]>;

  getExecutionsByTicket(ticketId: string): Promise<AgentExecution[]>;

  getExecutionsByPersona(personaId: string, limit?: number): Promise<AgentExecution[]>;
}
