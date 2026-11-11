/**
 * running = an agent mention is open (queued or executing) · idle = the agent
 * answered, the assistant has the hand · waiting = the user is asked (agent
 * question or mode request) · failed = the last agent run crashed, relaunchable ·
 * concluded = final.
 */
export type AgentThreadStatus = 'running' | 'idle' | 'waiting' | 'concluded' | 'failed';

/** What the assistant delegated to: a persona, or a skill / panel / workflow it runs. */
export type AgentThreadTargetType = 'agent' | 'skill' | 'panel' | 'workflow';

/** The last time a run of the thread was stopped on purpose, until a new run starts. */
export interface ThreadStop {
  /** `user` or `assistant`: a timeout or a crash is a failure, not a stop. */
  readonly by: 'user' | 'assistant';
  readonly at: string;
  readonly reason: string | null;
  /** The mention whose run was stopped: its late events no longer move the thread. */
  readonly mentionId: string | null;
}

/**
 * The runaway guard of a thread: the assistant may send it a bounded number of
 * turns, then must ask the human once whether to go on.
 */
export interface ThreadTurnCap {
  /** Assistant turns already sent when the human last said « Continuer »: the count restarts from there. */
  readonly base: number;
  /** When the « Continuer / Conclure » question was asked; null when none is pending. */
  readonly askedAt: string | null;
}

/**
 * Participant in a thread: userId, display name, and avatar URL.
 * Used for rendering the participants row in the thread label.
 */
export interface ThreadParticipant {
  readonly userId: string;
  readonly displayName: string;
  readonly avatar?: string;
}

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
  /** Haiku-generated title, computed serverside at the first message. Immutable. */
  readonly generatedTitle?: string | null;
  /** Participants who sent messages in this thread. Aggregated serverside. */
  readonly participants?: ThreadParticipant[] | null;
  /**
   * Set when a human stopped the thread's run: the assistant may not relaunch
   * this target until the human lifts it (writes in the thread, clicks
   * « Relancer », or sends the assistant a message after this instant).
   */
  readonly userHoldAt?: string | null;
  /** Who stopped the current run and when; cleared when a new run starts. */
  readonly lastStop?: ThreadStop | null;
  /** Who concluded the thread. `user`: the assistant does not reopen the target on its own. */
  readonly concludedBy?: 'user' | 'assistant' | null;
  /** Turn-cap state; absent until the cap was reached once. */
  readonly turnCap?: ThreadTurnCap | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly concludedAt: string | null;
}
