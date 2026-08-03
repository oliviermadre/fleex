import type {
  TicketMention,
  MentionStatus,
  MentionTargetType,
  MentionExecutionMode,
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

  resetToPending(): void {
    // `acknowledged` → the run was interrupted (startup recovery, timeout/cancel);
    // `failed` → the user asked to relaunch a crashed run from the crash card.
    // Both return to `pending` so the scheduler can (re-)dispatch the mention.
    if (this.status === 'acknowledged' || this.status === 'failed') {
      this.status = 'pending';
    }
  }

  /**
   * Mark the mention as crashed. Called when the SDK session dies — either at
   * startup (pre-acknowledge: usage limit, not logged in, workspace error) or
   * mid-run (post-acknowledge: usage limit, max turns, subprocess crash). Keeps
   * the mention out of a stuck `acknowledged`/`pending` state so the crash card
   * and the cockpit reflect reality. A `resolved` run never fails retroactively.
   */
  markFailed(): void {
    if (this.status === 'pending' || this.status === 'acknowledged') {
      this.status = 'failed';
    }
  }

  waitForInfo(): void {
    if (this.status === 'acknowledged') {
      this.status = 'waiting_for_info';
    }
  }

  wakeUp(): void {
    if (this.status === 'waiting_for_info') {
      this.status = 'pending';
    }
  }

  resolve(params?: { commentId?: string; deliverableId?: string }): void {
    this.status = 'resolved';
    this.resolvedAt = new Date();
    this.resolvedCommentId = params?.commentId ?? null;
    this.resolvedDeliverableId = params?.deliverableId ?? null;
  }

  isResolvableBy(agentName: string): boolean {
    return this.targetAgent === agentName && this.status !== 'resolved';
  }

  toDTO(): TicketMention {
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
    };
  }
}
