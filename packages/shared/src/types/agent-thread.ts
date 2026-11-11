/**
 * running = an agent mention is open (queued or executing) · idle = the agent
 * answered, the assistant has the hand · waiting = the user is asked (agent
 * question or mode request) · failed = the last agent run crashed, relaunchable ·
 * concluded = final.
 */
export type AgentThreadStatus = 'running' | 'idle' | 'waiting' | 'concluded' | 'failed';

/** What the assistant delegated to: a persona, or a skill / panel / workflow it runs. */
export type AgentThreadTargetType = 'agent' | 'skill' | 'panel' | 'workflow';

/**
 * A delegation opened by the assistant with one target (a persona, a skill, a
 * panel or a workflow) on a ticket.
 * Turns are ticket comments carrying `threadId === id`.
 */
export interface AgentThread {
  readonly id: string;
  readonly ticketId: string;
  readonly initiator: 'assistant';
  /** What `personaId` / `personaName` point at. */
  readonly targetType: AgentThreadTargetType;
  /** Id of the delegated target (persona, skill, panel or workflow template). */
  readonly personaId: string;
  /** Mention key of the target: `@<targetType>:<personaName>` (persona name, skill command, panel name, workflow slug). */
  readonly personaName: string;
  readonly assistantPersonaId: string;
  readonly brief: string;
  /** Context chips: 'ticket' | 'worktrees' | 'pr' | 'deliverables'. */
  readonly forwardedContext: string[];
  readonly status: AgentThreadStatus;
  readonly currentMentionId: string | null;
  readonly exchanges: number;
  /** Consecutive agent run failures on this thread (reset when a run completes). */
  readonly failures: number;
  readonly summary: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly concludedAt: string | null;
}
