import type { TicketContext, TicketContextEpic, TicketContextDelta } from '@fleex/shared';
import { TicketNotFoundError } from '../../domain/errors.js';
import type { TicketStorePort } from '../ports/ticket-store.port.js';
import type { CommentStorePort } from '../ports/comment-store.port.js';
import type { MentionStorePort } from '../ports/mention-store.port.js';
import type { DeliverableStorePort } from '../ports/deliverable-store.port.js';
import type { TicketGroupStorePort } from '../ports/ticket-group-store.port.js';
import type { DomainEventLogStorePort } from '../ports/domain-event-log-store.port.js';
import type { GetRelevantSummariesUseCase } from './get-relevant-summaries.js';

export class GetTicketContextUseCase {
  constructor(
    private readonly ticketStore: TicketStorePort,
    private readonly commentStore: CommentStorePort,
    private readonly mentionStore: MentionStorePort,
    private readonly deliverableStore: DeliverableStorePort,
    private readonly getRelevantSummaries?: GetRelevantSummariesUseCase,
    private readonly ticketGroupStore?: TicketGroupStorePort,
    private readonly domainEventLogStore?: DomainEventLogStorePort,
  ) {}

  async execute(params: {
    ticketId: string;
    agentName: string;
    commentsLimit?: number;
    activityLimit?: number;
    /**
     * When set, compute {@link TicketContextDelta}: what changed (edits,
     * deletions) since this timestamp — typically the agent's previous run on
     * this ticket — so a resumed LLM session can be told its stale transcript
     * is superseded.
     */
    sinceWatermark?: Date;
  }): Promise<TicketContext> {
    const ticket = await this.ticketStore.getTicketById(params.ticketId);
    if (!ticket) throw new TicketNotFoundError(params.ticketId);

    const commentsLimit = params.commentsLimit ?? 50;
    const activityLimit = params.activityLimit ?? 20;

    // Get comments visible to this agent (public + private where agent is recipient)
    const allComments = await this.commentStore.getByTicket(params.ticketId);
    const visibleComments = allComments
      .filter((c) => c.isVisibleTo(params.agentName))
      .slice(-commentsLimit);

    // Get mentions
    const allMentions = await this.mentionStore.getByTicket(params.ticketId);
    const pendingMentions = allMentions.filter(
      (m) => m.targetAgent === params.agentName && m.status !== 'resolved',
    );

    // Get deliverables
    const deliverables = await this.deliverableStore.getByTicket(params.ticketId);

    // Get activity
    const activity = await this.ticketStore.getActivitiesByTicket(params.ticketId, activityLimit);

    // Get relevant summaries from past tickets
    let relevantSummaries: Awaited<ReturnType<GetRelevantSummariesUseCase['execute']>> = [];
    if (this.getRelevantSummaries) {
      try {
        relevantSummaries = await this.getRelevantSummaries.execute({ ticketId: params.ticketId });
      } catch {
        // Non-critical — proceed without summaries
      }
    }

    // Get epics this ticket belongs to
    let epics: TicketContextEpic[] = [];
    if (this.ticketGroupStore) {
      try {
        const memberships = await this.ticketGroupStore.getMembershipsByTicket(params.ticketId);
        const groups = await Promise.all(
          memberships.map((m) => this.ticketGroupStore!.getTicketGroupById(m.groupId)),
        );
        epics = groups
          .filter(Boolean)
          .map((g) => ({
            name: g!.name,
            emoji: g!.emoji,
            description: g!.description,
            timeframe: g!.timeframe,
            groupStatus: g!.groupStatus,
          }));
      } catch {
        // Non-critical — proceed without epics
      }
    }

    // Compute the delta since the agent's previous run, if requested.
    let contextDelta: TicketContextDelta | undefined;
    if (params.sinceWatermark) {
      contextDelta = await this.computeDelta({
        ticketId: params.ticketId,
        agentName: params.agentName,
        watermark: params.sinceWatermark,
        comments: visibleComments,
        deliverables,
      });
    }

    return {
      ticket: ticket.toDTO(),
      comments: visibleComments.map((c) => c.toDTO()),
      mentions: {
        pending: pendingMentions.map((m) => m.toDTO()),
        all: allMentions.map((m) => m.toDTO()),
      },
      deliverables: deliverables.map((d) => d.toDTO()),
      activity: activity.map((a) => a.toDTO()),
      relevantSummaries,
      epics,
      ...(contextDelta ? { contextDelta } : {}),
    };
  }

  private async computeDelta(params: {
    ticketId: string;
    agentName: string;
    watermark: Date;
    comments: Awaited<ReturnType<CommentStorePort['getByTicket']>>;
    deliverables: Awaited<ReturnType<DeliverableStorePort['getByTicket']>>;
  }): Promise<TicketContextDelta> {
    const { watermark } = params;

    // Edited = seen before the watermark (created earlier) but edited since.
    const editedComments = params.comments.filter(
      (c) => c.lastEditedAt != null && c.lastEditedAt > watermark && c.createdAt <= watermark,
    );
    const editedDeliverables = params.deliverables.filter(
      (d) => d.lastEditedAt != null && d.lastEditedAt > watermark && d.createdAt <= watermark,
    );
    const selfAuthoredDeliverableEdited = editedDeliverables.some(
      (d) => d.agentName === params.agentName,
    );

    // Deletions are reconstructed from the audit log (the rows are gone).
    const deletedCommentIds = await this.deletedIdsSince('comment.deleted', 'commentId', params.ticketId, watermark);
    const deletedDeliverableIds = await this.deletedIdsSince('deliverable.deleted', 'deliverableId', params.ticketId, watermark);

    return {
      editedComments: editedComments.map((c) => c.toDTO()),
      editedDeliverables: editedDeliverables.map((d) => d.toDTO()),
      deletedCommentIds,
      deletedDeliverableIds,
      selfAuthoredDeliverableEdited,
    };
  }

  private async deletedIdsSince(
    eventType: string,
    idField: string,
    ticketId: string,
    since: Date,
  ): Promise<string[]> {
    if (!this.domainEventLogStore) return [];
    try {
      const entries = await this.domainEventLogStore.list({ limit: 200, eventType, since });
      return entries
        .filter((e) => e.payload['ticketId'] === ticketId)
        .map((e) => e.payload[idField])
        .filter((id): id is string => typeof id === 'string');
    } catch {
      return [];
    }
  }
}
