import type { AgentThread, AgentThreadStatus } from '@fleex/shared';

/**
 * A delegation the assistant opened with one agent persona on a ticket. Its
 * status mirrors the mention currently driving it; `concluded` and `failed`
 * are terminal — every transition on a terminal thread is a no-op that
 * returns false, so a late mention event can never resurrect a closed thread.
 */
export class AgentThreadEntity {
  constructor(
    public readonly id: string,
    public readonly ticketId: string,
    public readonly initiator: 'assistant',
    public readonly personaId: string,
    public readonly personaName: string,
    public readonly assistantPersonaId: string,
    public readonly brief: string,
    public readonly forwardedContext: string[],
    public status: AgentThreadStatus,
    public currentMentionId: string | null,
    public exchanges: number,
    public failures: number,
    public summary: string | null,
    public readonly createdAt: Date,
    public updatedAt: Date,
    public concludedAt: Date | null,
  ) {}

  static create(params: {
    id: string;
    ticketId: string;
    personaId: string;
    personaName: string;
    assistantPersonaId: string;
    brief: string;
    forwardedContext: string[];
  }): AgentThreadEntity {
    const now = new Date();
    return new AgentThreadEntity(
      params.id, params.ticketId, 'assistant', params.personaId, params.personaName,
      params.assistantPersonaId, params.brief, [...params.forwardedContext],
      'running', null, 0, 0, null, now, now, null,
    );
  }

  /**
   * Only `concluded` is final. A `failed` thread (agent run crashed or hit its
   * turn cap) stays open so the assistant can relaunch the agent in place —
   * the project manager keeps the hand instead of bouncing to the user.
   */
  get isTerminal(): boolean {
    return this.status === 'concluded';
  }

  /** The assistant posted a turn that opened `mentionId` on the agent. */
  openTurn(mentionId: string): boolean {
    if (this.isTerminal) return false;
    this.currentMentionId = mentionId;
    this.exchanges += 1;
    this.status = 'running';
    this.touch();
    return true;
  }

  /** A turn that opened no mention (agent reply, user or assistant answer). */
  recordTurn(): boolean {
    if (this.isTerminal) return false;
    this.exchanges += 1;
    this.touch();
    return true;
  }

  markWaiting(): boolean {
    if (this.isTerminal) return false;
    this.status = 'waiting';
    this.touch();
    return true;
  }

  markRunning(): boolean {
    if (this.isTerminal) return false;
    this.status = 'running';
    this.touch();
    return true;
  }

  conclude(summary: string): boolean {
    if (this.isTerminal) return false;
    this.status = 'concluded';
    this.summary = summary;
    this.concludedAt = new Date();
    this.touch();
    return true;
  }

  /** The agent run driving this thread crashed or hit its turn cap. */
  fail(): boolean {
    if (this.isTerminal) return false;
    this.status = 'failed';
    this.failures += 1;
    this.touch();
    return true;
  }

  /** A run completed: the failure streak is over. */
  clearFailures(): void {
    this.failures = 0;
  }

  private touch(): void {
    this.updatedAt = new Date();
  }

  toDTO(): AgentThread {
    return {
      id: this.id,
      ticketId: this.ticketId,
      initiator: this.initiator,
      personaId: this.personaId,
      personaName: this.personaName,
      assistantPersonaId: this.assistantPersonaId,
      brief: this.brief,
      forwardedContext: [...this.forwardedContext],
      status: this.status,
      currentMentionId: this.currentMentionId,
      exchanges: this.exchanges,
      failures: this.failures,
      summary: this.summary,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
      concludedAt: this.concludedAt?.toISOString() ?? null,
    };
  }
}
