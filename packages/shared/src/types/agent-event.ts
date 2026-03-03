export interface AgentExecution {
  readonly id: string;
  readonly personaId: string;
  readonly ticketId: string;
  readonly mentionId: string;
  readonly eventCount: number;
  readonly status: 'running' | 'completed' | 'failed' | 'interrupted';
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly sdkSessionId?: string | null;
}

export type AgentEventType =
  | 'message_start'
  | 'content_block_start'
  | 'content_block_delta'
  | 'content_block_stop'
  | 'message_delta'
  | 'message_stop'
  | 'turn_start'
  | 'turn_end'
  | 'execution_start'
  | 'execution_end'
  | 'error';

export interface AgentEvent {
  readonly id: string;
  readonly executionId: string;
  readonly eventType: AgentEventType;
  readonly data: unknown;
  readonly sequence: number;
  readonly createdAt: string;
}

export type AgentEventWsMessageType =
  | 'agent_event:delta'
  | 'agent_event:batch'
  | 'agent_event:execution_start'
  | 'agent_event:execution_end';

export interface AgentEventWsMessage {
  readonly type: AgentEventWsMessageType;
  readonly executionId: string;
  readonly ticketId: string;
  readonly data: AgentEvent | AgentEvent[] | AgentExecution;
}
