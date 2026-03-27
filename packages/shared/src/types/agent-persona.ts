export type ExecutionMode = 'claude_code' | 'message';

export interface AgentPersona {
  readonly id: string;
  readonly name: string;
  readonly displayName: string;
  readonly model: string;
  readonly executionMode: ExecutionMode;
  readonly soulMd: string;
  readonly identityMd: string;
  readonly memoryMd: string;
  readonly humanMentionName: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateAgentPersonaRequest {
  readonly name: string;
  readonly displayName: string;
  readonly model?: string;
  readonly executionMode?: ExecutionMode;
  readonly soulMd?: string;
  readonly identityMd?: string;
  readonly memoryMd?: string;
  readonly humanMentionName?: string | null;
}

export interface UpdateAgentPersonaRequest {
  readonly name?: string;
  readonly displayName?: string;
  readonly model?: string;
  readonly executionMode?: ExecutionMode;
  readonly soulMd?: string;
  readonly identityMd?: string;
  readonly memoryMd?: string;
  readonly humanMentionName?: string | null;
}

export interface AgentStructuredOutput {
  deliverable: { title: string; markdown: string; type: string; status: 'draft' | 'final' } | null;
  comment: string | null;
  mentionStatus?: 'resolved' | 'waiting_for_info';
}

export type AgentExecutionStatus = 'no_work' | 'started' | 'already_running';

export interface AgentExecutionResult {
  readonly status: AgentExecutionStatus;
  readonly mentionIds: string[];
  readonly errors?: string[];
}

export type PersonaWsMessageType =
  | 'persona:created'
  | 'persona:updated'
  | 'persona:deleted'
  | 'persona:execution_started'
  | 'persona:execution_completed'
  | 'persona:execution_failed';

export interface PersonaWsMessage {
  readonly type: PersonaWsMessageType;
  readonly data: unknown;
}
