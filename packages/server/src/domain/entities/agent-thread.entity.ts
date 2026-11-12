import type { AgentThread, AgentThreadStatus, AgentThreadTargetType, ThreadParticipant, ThreadStop, ThreadTurnCap } from '@fleex/shared';

/**
 * A delegation the assistant opened with one target (persona, skill, panel or
 * workflow — `targetType`) on a ticket. `personaId` / `personaName` are the
 * target's id and mention key whatever its type. Its
 * status mirrors the mention currently driving it; `concluded` and `failed`
 * are terminal — every transition on a terminal thread is a no-op that
 * returns false, so a late mention event can never resurrect a closed thread.
 */
const DELIVERABLE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class AgentThreadEntity {
  constructor(
    public readonly id: string,
    public readonly ticketId: string,
    public readonly initiator: 'assistant',
    public readonly personaId: string,
    public readonly personaName: string,
    public readonly assistantPersonaId: string,
    public readonly brief: string,
    /**
     * What of the ticket the assistant exposes to this thread, beyond the
     * thread's own turns: ids of the deliverables its target may read. (Threads
     * opened before this carried decorative keys — `ticket`, `pr`… — which are
     * ignored.)
     */
    public forwardedContext: string[],
    public status: AgentThreadStatus,
    public currentMentionId: string | null,
    public exchanges: number,
    public failures: number,
    public summary: string | null,
    public readonly createdAt: Date,
    public updatedAt: Date,
    public concludedAt: Date | null,
    public readonly targetType: AgentThreadTargetType = 'agent',
    public generatedTitle: string | null = null,
    public participants: ThreadParticipant[] = [],
    /** When a human stopped the run. While set, the assistant may not relaunch the target. */
    public userHoldAt: Date | null = null,
    /** The last wanted stop of the current run; a new run clears it. */
    public lastStop: ThreadStop | null = null,
    public concludedBy: 'user' | 'assistant' | null = null,
    /** Runaway guard: where the turn count restarts, and whether the human is being asked. */
    public turnCap: ThreadTurnCap | null = null,
  ) {}

  static create(params: {
    id: string;
    ticketId: string;
    personaId: string;
    personaName: string;
    assistantPersonaId: string;
    brief: string;
    forwardedContext: string[];
    targetType?: AgentThreadTargetType;
  }): AgentThreadEntity {
    const now = new Date();
    return new AgentThreadEntity(
      params.id, params.ticketId, 'assistant', params.personaId, params.personaName,
      params.assistantPersonaId, params.brief, [...params.forwardedContext],
      'running', null, 0, 0, null, now, now, null, params.targetType ?? 'agent',
      null, // generatedTitle
      [],   // participants
    );
  }

  /** Ids of the ticket deliverables this thread's target may read, besides the ones it produced itself. */
  get sharedDeliverableIds(): string[] {
    return this.forwardedContext.filter((x) => DELIVERABLE_ID.test(x));
  }

  /** The assistant edits what the thread sees, at any time while it is open. Returns the new list. */
  shareDeliverables(add: readonly string[], remove: readonly string[] = []): string[] {
    const gone = new Set(remove);
    const next = [...new Set([...this.sharedDeliverableIds, ...add])].filter((id) => !gone.has(id));
    this.forwardedContext = next;
    this.updatedAt = new Date();
    return next;
  }

  /** How a comment addresses this thread's target: `@agent:x`, `@skill:x`, `@panel:x`, `@workflow:x`. */
  get mentionTag(): string {
    return `@${this.targetType}:${this.personaName}`;
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
    // A new run: the previous stop is history, and whoever was allowed to
    // launch it (see `continueThread`) has lifted the hold.
    this.userHoldAt = null;
    this.lastStop = null;
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

  /** The agent's run completed and it answered: the ball is in the assistant's court. */
  markIdle(): boolean {
    if (this.isTerminal) return false;
    this.status = 'idle';
    this.touch();
    return true;
  }

  /**
   * The current run was stopped on purpose. Not a failure: the thread goes
   * `idle` and `failures` does not move. A stop by the human also sets the
   * hold, which only a human action lifts. Events the stopped mention still
   * emits afterwards are recognised through `lastStop.mentionId` and ignored.
   */
  recordStop(by: 'user' | 'assistant', reason: string | null = null): boolean {
    if (this.isTerminal) return false;
    const now = new Date();
    this.status = 'idle';
    this.lastStop = { by, at: now.toISOString(), reason, mentionId: this.currentMentionId };
    // A hold already standing keeps its date: a later stop by the assistant
    // must not look like a newer human decision, nor erase the human's.
    if (by === 'user') this.userHoldAt = now;
    this.touch();
    return true;
  }

  /** True when `mentionId` is the run that was stopped on purpose: its late events are not news. */
  isStoppedMention(mentionId: string | null | undefined): boolean {
    return !!mentionId && this.lastStop?.mentionId === mentionId;
  }

  /** A human lifted the hold (wrote in the thread, clicked « Relancer »). False when none stood. */
  liftUserHold(): boolean {
    if (!this.userHoldAt) return false;
    this.userHoldAt = null;
    this.touch();
    return true;
  }

  /** Assistant turns counted against the cap restart after this many. */
  get turnCapBase(): number {
    return this.turnCap?.base ?? 0;
  }

  /** When the « Continuer / Conclure » question was asked, while it is unanswered. */
  get turnCapAskedAt(): Date | null {
    return this.turnCap?.askedAt ? new Date(this.turnCap.askedAt) : null;
  }

  /**
   * The cap is reached: the human is asked, once. The thread waits on them;
   * it is not concluded. False when the question is already pending.
   */
  askTurnCap(): boolean {
    if (this.isTerminal || this.turnCap?.askedAt) return false;
    this.turnCap = { base: this.turnCapBase, askedAt: new Date().toISOString() };
    this.status = 'waiting';
    this.touch();
    return true;
  }

  /** The human said to go on: the count restarts from the `sent` turns already there. */
  resetTurnCap(sent: number): boolean {
    if (this.isTerminal) return false;
    this.turnCap = { base: sent, askedAt: null };
    this.touch();
    return true;
  }

  markRunning(): boolean {
    if (this.isTerminal) return false;
    this.status = 'running';
    this.touch();
    return true;
  }

  conclude(summary: string, by: 'user' | 'assistant' = 'assistant'): boolean {
    if (this.isTerminal) return false;
    this.status = 'concluded';
    this.summary = summary;
    this.concludedBy = by;
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
      targetType: this.targetType,
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
      generatedTitle: this.generatedTitle,
      participants: this.participants,
      userHoldAt: this.userHoldAt?.toISOString() ?? null,
      lastStop: this.lastStop,
      concludedBy: this.concludedBy,
      turnCap: this.turnCap,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
      concludedAt: this.concludedAt?.toISOString() ?? null,
    };
  }
}
