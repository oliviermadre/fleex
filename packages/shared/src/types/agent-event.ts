export interface AgentExecution {
  readonly id: string;
  readonly personaId: string;
  readonly ticketId: string;
  readonly mentionId: string;
  readonly eventCount: number;
  readonly status: 'running' | 'completed' | 'failed' | 'interrupted';
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly lastEventAt: string | null;
  readonly sdkSessionId?: string | null;
  readonly model?: string | null;
  readonly effectiveMode?: string | null;
  readonly durationMs?: number | null;
  readonly costUsd?: number | null;
  readonly inputTokens?: number | null;
  readonly outputTokens?: number | null;
  readonly cacheReadTokens?: number | null;
  readonly cacheCreationTokens?: number | null;
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
  | 'execution_retry'
  | 'error';

export interface AgentEvent {
  readonly id: string;
  readonly executionId: string;
  readonly eventType: AgentEventType;
  readonly data: unknown;
  readonly sequence: number;
  readonly createdAt: string;
}

/** One member of an aggregated panel run */
export interface PanelMemberSummary {
  readonly personaId: string;
  readonly displayName: string;
  readonly initials: string;
  readonly status: AgentExecution['status'];
  readonly isOrchestrator: boolean;
}

/** Enriched execution entry for the Execution Log view */
export interface ExecutionLogEntry extends AgentExecution {
  readonly type: 'agent' | 'panel' | 'skill';
  readonly executorName: string;
  readonly ticketTitle: string | null;
  readonly ticketSlug: string | null;
  readonly ticketPriority: string | null;
  readonly ticketType: string | null;
  readonly commentCount: number;
  readonly deliverableCount: number;
  /** Only set for aggregated panel runs (type === 'panel' with multiple members). */
  readonly panelDisplayName?: string;
  readonly panelMembers?: PanelMemberSummary[];
  readonly memberCount?: number;
}

/**
 * Derive 1–2 letter initials from a display name. "Security Nerd" → "SN";
 * "Builder" → "BU". Returns "?" for empty input.
 */
export function computeInitials(displayName: string): string {
  const trimmed = displayName.trim();
  if (!trimmed) return '?';
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return (words[0]![0]! + words[1]![0]!).toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}

export interface ExecutionLogResponse {
  readonly entries: ExecutionLogEntry[];
  readonly total: number;
  readonly liveCount: number;
  readonly historyCount: number;
  readonly typeCounts: {
    readonly all: number;
    readonly agent: number;
    readonly panel: number;
    readonly skill: number;
  };
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
