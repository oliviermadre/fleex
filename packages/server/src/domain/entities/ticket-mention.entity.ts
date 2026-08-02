import type {
  TicketMention,
  MentionStatus,
  MentionTargetType,
  MentionExecutionMode,
  MentionFailureReason,
} from '@fleex/shared';

export class TicketMentionEntity {
  constructor(
    public readonly id: string,
    public readonly ticketId: string,
    public readonly commentId: string,
    public readonly targetAgent: string,
    public readonly sourceAgent: string,
    public readonly targetType: MentionTargetType,
    public executionMode: MentionExecutionMode,
    public status: MentionStatus,
    public resolvedAt: Date | null,
    public resolvedCommentId: string | null,
    public resolvedDeliverableId: string | null,
    public readonly createdAt: Date,
    /** SDK executions started since the last success / human instruction. */
    public attemptCount: number = 0,
    /** Cause of the last failure — persisted so the crash card survives a reload. */
    public failureReason: MentionFailureReason | null = null,
    /** Raw technical detail for the failure (stderr excerpt, SDK error text). */
    public failureDetail: string | null = null,
  ) {}

  static create(params: {
    id: string;
    ticketId: string;
    commentId: string;
    targetAgent: string;
    sourceAgent: string;
    targetType?: MentionTargetType;
    executionMode?: MentionExecutionMode;
  }): TicketMentionEntity {
    return new TicketMentionEntity(
      params.id,
      params.ticketId,
      params.commentId,
      params.targetAgent,
      params.sourceAgent,
      params.targetType ?? 'agent',
      params.executionMode ?? 'plan',
      'pending',
      null,
      null,
      null,
      new Date(),
    );
  }

  acknowledge(): void {
    if (this.status === 'pending') {
      this.status = 'acknowledged';
    }
  }

  /**
   * Return a mention to the dispatch queue. Called from EXACTLY ONE place —
   * `ExecuteAgentUseCase.runMention` — i.e. only on an explicit human action
   * (▶ / Relaunch / Force relaunch).
   *
   * This is the load-bearing invariant of `docs/execution-recovery-policy.md`:
   * `handleAutoTriggerAgent` sweeps *every* `pending` mention of a persona, so
   * any silent re-queue (timeout, cancel, server restart) turns the next
   * unrelated mention to that agent into an invisible retry of a crashed run.
   */
  resetToPending(): void {
    if (this.status === 'acknowledged' || this.status === 'failed') {
      this.status = 'pending';
    }
  }

  /**
   * Charge one execution attempt. Called at dispatch, BEFORE the worktree is
   * created, so failures that never reach the SDK (workspace error, quota,
   * auth) are counted too. Internal retries that stay inside one dispatch (the
   * stale-resume retry) deliberately do not call this.
   */
  startAttempt(): void {
    this.attemptCount += 1;
  }

  /** Give the mention a fresh budget (successful run, or a forced relaunch). */
  resetAttempts(): void {
    this.attemptCount = 0;
  }

  /**
   * True once the mention has burned its budget and may only be relaunched by
   * an explicit "Force relaunch". Dead-letter is a derived predicate, not a
   * mention status — that keeps the 4 store adapters and every status filter
   * untouched. A ceiling of 0 or less disables the cap, so a bad config can
   * never freeze an instance.
   */
  isExhausted(maxAttempts: number): boolean {
    if (maxAttempts <= 0) return false;
    return this.attemptCount >= maxAttempts;
  }

  /**
   * Terminal state for any execution that did not complete normally: crash,
   * timeout, user cancellation, or server restart. Never sends the mention back
   * to `pending` — see `resetToPending`.
   *
   * Only acts on `pending`/`acknowledged`: a `resolved` or `waiting_for_info`
   * mention never fails retroactively. Idempotent on an already-`failed`
   * mention, so when a timeout and a cancel race the first cause is kept.
   */
  markFailed(reason: MentionFailureReason, detail?: string): void {
    if (this.status !== 'pending' && this.status !== 'acknowledged') return;
    this.status = 'failed';
    this.failureReason = reason;
    this.failureDetail = detail?.trim() ? detail : null;
  }

  /** Drop a stale failure cause (relaunch): the card must not show it again. */
  clearFailure(): void {
    this.failureReason = null;
    this.failureDetail = null;
  }

  waitForInfo(): void {
    if (this.status === 'acknowledged') {
      this.status = 'waiting_for_info';
    }
  }

  /**
   * A human answered a parked mention. That is a NEW instruction, not a retry,
   * so the attempt budget starts over.
   */
  wakeUp(): void {
    if (this.status === 'waiting_for_info') {
      this.status = 'pending';
      this.resetAttempts();
    }
  }

  resolve(params?: { commentId?: string; deliverableId?: string }): void {
    this.status = 'resolved';
    this.resolvedAt = new Date();
    this.resolvedCommentId = params?.commentId ?? null;
    this.resolvedDeliverableId = params?.deliverableId ?? null;
    // A success wipes the slate: past failures must not dead-letter the next run.
    this.resetAttempts();
    this.clearFailure();
  }

  isResolvableBy(agentName: string): boolean {
    return this.targetAgent === agentName && this.status !== 'resolved';
  }

  /**
   * @param maxAttempts the configured ceiling to advertise. Pass it on the
   * surfaces the crash card reads (ticket routes, WS broadcasts) so the card can
   * render "Attempt 2/3" and switch to Force relaunch. Defaults to `0` ("no cap
   * advertised") on surfaces that don't drive that UI (agent API, statistics).
   */
  toDTO(maxAttempts = 0): TicketMention {
    return {
      id: this.id,
      ticketId: this.ticketId,
      commentId: this.commentId,
      targetAgent: this.targetAgent,
      sourceAgent: this.sourceAgent,
      targetType: this.targetType,
      executionMode: this.executionMode,
      status: this.status,
      resolvedAt: this.resolvedAt?.toISOString() ?? null,
      resolvedCommentId: this.resolvedCommentId,
      resolvedDeliverableId: this.resolvedDeliverableId,
      createdAt: this.createdAt.toISOString(),
      attemptCount: this.attemptCount,
      maxAttempts,
      failureReason: this.failureReason,
      failureDetail: this.failureDetail,
    };
  }
}
