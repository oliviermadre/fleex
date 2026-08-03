import type { TicketContext, TicketContextEpic } from '@fleex/shared';

import { TicketNotFoundError } from '../../domain/errors.js';

import type { GetRelevantSummariesUseCase } from './get-relevant-summaries.js';
import type { CommentStorePort } from '../ports/comment-store.port.js';
import type { DeliverableStorePort } from '../ports/deliverable-store.port.js';
import type { MentionStorePort } from '../ports/mention-store.port.js';
import type { TicketGroupStorePort } from '../ports/ticket-group-store.port.js';
import type { TicketStorePort } from '../ports/ticket-store.port.js';

export class GetTicketContextUseCase {
  constructor(
    private readonly ticketStore: TicketStorePort,
    private readonly commentStore: CommentStorePort,
    private readonly mentionStore: MentionStorePort,
    private readonly deliverableStore: DeliverableStorePort,
    private readonly getRelevantSummaries?: GetRelevantSummariesUseCase,
    private readonly ticketGroupStore?: TicketGroupStorePort,
  ) {}

  async execute(params: {
    ticketId: string;
    agentName: string;
    commentsLimit?: number;
    activityLimit?: number;
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
        epics = groups.filter(Boolean).map((g) => ({
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
    };
  }
}
