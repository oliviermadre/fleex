/**
 * running = an agent mention is open (queued or executing) · idle = the agent
 * answered, the assistant has the hand · waiting = the user is asked (agent
 * question or mode request) · failed = the last agent run crashed, relaunchable ·
 * concluded = final.
 */
export type AgentThreadStatus = 'running' | 'idle' | 'waiting' | 'concluded' | 'failed';

/**
 * A delegation opened by the assistant with one agent persona on a ticket.
 * Turns are ticket comments carrying `threadId === id`.
 */
export interface AgentThread {
  readonly id: string;
  readonly ticketId: string;
  readonly initiator: 'assistant';
  readonly personaId: string;
  /** Mention key of the delegated persona (`@agent:<personaName>`). */
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
