import { randomUUID } from 'node:crypto';
import { TicketActivityEntity } from '../../domain/entities/ticket-activity.entity.js';
import type { MentionStorePort } from '../ports/mention-store.port.js';
import type { TicketStorePort } from '../ports/ticket-store.port.js';
import type { LoggerPort } from '../ports/logger.port.js';
import type { ConfigPort } from '../ports/config.port.js';

interface ReviewWorkflowConfig {
  // Default human reviewer when no specific human mentioned
  defaultReviewer: string;

  // Auto-block tickets when agents wait for info
  autoBlockOnWaiting: boolean;

  // Enable/disable auto-review workflow
  enableAutoReview: boolean;
}

export class AutoReviewWorkflowUseCase {
  /** Set by WS plugin to broadcast ticket updates in real-time */
  public onTicketUpdate: ((type: string, data: unknown) => void) | null = null;

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
   * Rule 1A: Handle human mention in comment - immediate transition to reviewing.
   * This is the only auto-transition that remains — explicit human @mention is intentional.
   */
  async handleHumanMention(params: {
    ticketId: string;
    mentionedHuman: string;
  }): Promise<void> {
    const config = this.getWorkflowConfig();
    if (!config.enableAutoReview) return;

    const ticket = await this.ticketStore.getTicketById(params.ticketId);
    if (!ticket || ticket.status === 'reviewing' || ticket.status === 'done' || ticket.status === 'cancelled') {
      return; // Already in review, done, or cancelled
    }

    this.logger.info('Moving ticket to reviewing due to human mention', {
      ticketId: params.ticketId,
      mentionedHuman: params.mentionedHuman,
      currentStatus: ticket.status,
    });

    // Move to reviewing and assign to human
    const diff = ticket.moveTo('reviewing');
    const assignDiff = ticket.assign(params.mentionedHuman);

    await this.ticketStore.saveTicket(ticket);
    this.onTicketUpdate?.('ticket:updated', ticket.toDTO());
    await this.ticketStore.saveActivity(TicketActivityEntity.create({
      id: randomUUID(),
      ticketId: params.ticketId,
      action: 'moved_to_review_via_human_mention',
      changes: { ...diff, ...assignDiff },
      actorType: 'agent',
      actorName: 'system',
      source: 'api',
    }));

    this.logger.info('Ticket moved to reviewing via human mention', {
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
      this.onTicketUpdate?.('ticket:updated', ticket.toDTO());

      await this.ticketStore.saveActivity(TicketActivityEntity.create({
        id: randomUUID(),
        ticketId: params.ticketId,
        action: 'auto_blocked_waiting_for_info',
        changes: diff,
        actorType: 'agent',
        actorName: params.agentName,
        source: 'api',
      }));

      this.logger.info('Auto-blocked ticket due to agent waiting for info', {
        ticketId: params.ticketId,
        agentName: params.agentName,
      });
    }
  }

  /**
   * When a human posts a comment, resolve all unresolved mentions targeting humans on that ticket.
   */
  async handleHumanCommentPosted(params: {
    ticketId: string;
  }): Promise<void> {
    const mentions = await this.mentionStore.getByTicket(params.ticketId);
    const unresolvedHuman = mentions.filter(
      (m) => m.targetType === 'human' && m.status !== 'resolved',
    );

    for (const mention of unresolvedHuman) {
      mention.resolve();
      await this.mentionStore.save(mention);
      this.onTicketUpdate?.('mention:updated', mention.toDTO());
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
  async handleTicketDone(params: {
    ticketId: string;
  }): Promise<void> {
    const mentions = await this.mentionStore.getByTicket(params.ticketId);
    const unresolved = mentions.filter((m) => m.status !== 'resolved');

    for (const mention of unresolved) {
      mention.resolve();
      await this.mentionStore.save(mention);
      this.onTicketUpdate?.('mention:updated', mention.toDTO());
    }

    if (unresolved.length > 0) {
      this.logger.info('Auto-resolved all mentions after ticket moved to done', {
        ticketId: params.ticketId,
        resolvedCount: unresolved.length,
      });
    }
  }
}
