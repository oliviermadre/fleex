import { randomUUID } from 'node:crypto';

import { TicketActivityEntity } from '../../domain/entities/ticket-activity.entity.js';

import type { EventBus } from '../event-bus.js';
import type { ConfigPort } from '../ports/config.port.js';
import type { LoggerPort } from '../ports/logger.port.js';
import type { MentionStorePort } from '../ports/mention-store.port.js';
import type { TicketStorePort } from '../ports/ticket-store.port.js';

interface ReviewWorkflowConfig {
  // Default human reviewer when no specific human mentioned
  defaultReviewer: string;

  // Auto-block tickets when agents wait for info
  autoBlockOnWaiting: boolean;

  // Enable/disable auto-review workflow
  enableAutoReview: boolean;
}

export class AutoReviewWorkflowUseCase {
  public eventBus?: EventBus;

  constructor(
    private readonly mentionStore: MentionStorePort,
    private readonly ticketStore: TicketStorePort,
    private readonly config: ConfigPort,
    private readonly logger: LoggerPort,
  ) {}

  private getWorkflowConfig(): ReviewWorkflowConfig {
    const configData = this.config.get();
    return {
      defaultReviewer: configData.humanMentionName || configData.humanDisplayName || 'nas',
      autoBlockOnWaiting: true,
      enableAutoReview: true,
    };
  }

  /**
   * Handle human mention in comment — unclaim agent and assign the mentioned human.
   * No status change: ticket stays in its current column.
   */
  async handleHumanMention(params: { ticketId: string; mentionedHuman: string }): Promise<void> {
    const config = this.getWorkflowConfig();
    if (!config.enableAutoReview) return;

    const ticket = await this.ticketStore.getTicketById(params.ticketId);
    if (!ticket || ticket.status === 'done' || ticket.status === 'cancelled') {
      return;
    }

    this.logger.info('Unclaiming agent and assigning human due to human mention', {
      ticketId: params.ticketId,
      mentionedHuman: params.mentionedHuman,
      currentStatus: ticket.status,
    });

    // Unclaim agent and assign human (no status change)
    // Use 'user' as the assignee value — the frontend maps this to "Me" with an amber badge.
    const unclaimDiff = ticket.unclaim();
    const assignDiff = ticket.assign('user');

    await this.ticketStore.saveTicket(ticket);
    this.eventBus?.emit({
      type: 'ticket.updated',
      ticketId: params.ticketId,
      changes: { ...unclaimDiff, ...assignDiff },
      occurredAt: new Date(),
    });
    await this.ticketStore.saveActivity(
      TicketActivityEntity.create({
        id: randomUUID(),
        ticketId: params.ticketId,
        action: 'unclaimed_and_assigned_human_via_mention',
        changes: { ...unclaimDiff, ...assignDiff },
        actorType: 'agent',
        actorName: 'system',
        source: 'api',
      }),
    );

    this.logger.info('Agent unclaimed and human assigned via mention', {
      ticketId: params.ticketId,
      assignedTo: params.mentionedHuman,
    });
  }

  /**
   * Handle agent work completion — log only, no status transition.
   * Status changes are manual only; agents never move tickets.
   */
  async handleAgentWorkCompletion(params: {
    ticketId: string;
    completedAgentName: string;
  }): Promise<void> {
    this.logger.info('Agent work completed (no auto-transition)', {
      ticketId: params.ticketId,
      completedAgent: params.completedAgentName,
    });
  }

  /**
   * Handle agent mention while in reviewing — log only, no status transition.
   * Status changes are manual only; agents never move tickets.
   */
  async handleAgentMentionInReview(params: {
    ticketId: string;
    mentionedAgent: string;
  }): Promise<void> {
    this.logger.info('Agent mentioned in reviewing ticket (no auto-transition)', {
      ticketId: params.ticketId,
      mentionedAgent: params.mentionedAgent,
    });
  }

  /**
   * Handle deliverable creation — log only, no status transition.
   * Status changes are manual only; agents never move tickets.
   */
  async handleDeliverableCreated(params: {
    ticketId: string;
    agentName: string;
    status: 'draft' | 'final';
  }): Promise<void> {
    this.logger.info('Deliverable created (no auto-transition)', {
      ticketId: params.ticketId,
      agentName: params.agentName,
      status: params.status,
    });
  }

  /**
   * Handle mention status change to waiting_for_info
   */
  async handleMentionWaitingForInfo(params: {
    ticketId: string;
    agentName: string;
  }): Promise<void> {
    const config = this.getWorkflowConfig();
    if (!config.autoBlockOnWaiting) return;

    const ticket = await this.ticketStore.getTicketById(params.ticketId);
    if (!ticket) return;

    if (!ticket.blocked) {
      const diff = ticket.update({ blocked: true });
      await this.ticketStore.saveTicket(ticket);
      this.eventBus?.emit({
        type: 'ticket.updated',
        ticketId: params.ticketId,
        changes: diff,
        occurredAt: new Date(),
      });

      await this.ticketStore.saveActivity(
        TicketActivityEntity.create({
          id: randomUUID(),
          ticketId: params.ticketId,
          action: 'auto_blocked_waiting_for_info',
          changes: diff,
          actorType: 'agent',
          actorName: params.agentName,
          source: 'api',
        }),
      );

      this.logger.info('Auto-blocked ticket due to agent waiting for info', {
        ticketId: params.ticketId,
        agentName: params.agentName,
      });
    }
  }

  /**
   * When a human posts a comment, resolve all unresolved mentions targeting humans on that ticket.
   */
  async handleHumanCommentPosted(params: { ticketId: string }): Promise<void> {
    const mentions = await this.mentionStore.getByTicket(params.ticketId);
    const unresolvedHuman = mentions.filter(
      (m) => m.targetType === 'human' && m.status !== 'resolved',
    );

    for (const mention of unresolvedHuman) {
      mention.resolve();
      await this.mentionStore.save(mention);
      this.eventBus?.emit({
        type: 'mention.resolved',
        mentionId: mention.id,
        ticketId: params.ticketId,
        targetAgent: mention.targetAgent,
        resolvedBy: 'system',
        occurredAt: new Date(),
      });
    }

    if (unresolvedHuman.length > 0) {
      this.logger.info('Auto-resolved human mentions after human comment', {
        ticketId: params.ticketId,
        resolvedCount: unresolvedHuman.length,
      });
    }
  }

  /**
   * When a ticket moves to done, resolve all unresolved mentions on that ticket.
   */
  async handleTicketDone(params: { ticketId: string }): Promise<void> {
    const mentions = await this.mentionStore.getByTicket(params.ticketId);
    const unresolved = mentions.filter((m) => m.status !== 'resolved');

    for (const mention of unresolved) {
      mention.resolve();
      await this.mentionStore.save(mention);
      this.eventBus?.emit({
        type: 'mention.resolved',
        mentionId: mention.id,
        ticketId: params.ticketId,
        targetAgent: mention.targetAgent,
        resolvedBy: 'system',
        occurredAt: new Date(),
      });
    }

    if (unresolved.length > 0) {
      this.logger.info('Auto-resolved all mentions after ticket moved to done', {
        ticketId: params.ticketId,
        resolvedCount: unresolved.length,
      });
    }
  }
}
