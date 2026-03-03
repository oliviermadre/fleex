import type { TicketMention, MentionStatus, MentionTargetType } from '@asm/shared';

export class TicketMentionEntity {
  constructor(
    public readonly id: string,
    public readonly ticketId: string,
    public readonly commentId: string,
    public readonly targetAgent: string,
    public readonly sourceAgent: string,
    public readonly targetType: MentionTargetType,
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
  }): TicketMentionEntity {
    return new TicketMentionEntity(
      params.id,
      params.ticketId,
      params.commentId,
      params.targetAgent,
      params.sourceAgent,
      params.targetType ?? 'agent',
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
    if (this.status === 'acknowledged') {
      this.status = 'pending';
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
      status: this.status,
      resolvedAt: this.resolvedAt?.toISOString() ?? null,
      resolvedCommentId: this.resolvedCommentId,
      resolvedDeliverableId: this.resolvedDeliverableId,
      createdAt: this.createdAt.toISOString(),
    };
  }
}
