import { randomUUID } from 'node:crypto';
import { TicketActivityEntity } from '../../domain/entities/ticket-activity.entity.js';
import type { MentionStorePort } from '../ports/mention-store.port.js';
import type { TicketStorePort } from '../ports/ticket-store.port.js';
import type { LoggerPort } from '../ports/logger.port.js';
import type { ConfigPort } from '../ports/config.port.js';

interface ReviewWorkflowConfig {
  // Default human reviewer when no specific human mentioned
  defaultReviewer: string;

  // Delay before auto-transitioning to review (prevents race conditions)
  autoReviewDelayMs: number;

  // Board-specific QA agent (optional)
  qaAgentName?: string;

  // Auto-block tickets when agents wait for info
  autoBlockOnWaiting: boolean;

  // Enable/disable auto-review workflow
  enableAutoReview: boolean;
}

export class AutoReviewWorkflowUseCase {
  private pendingTransitions = new Map<string, NodeJS.Timeout>();

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
      autoReviewDelayMs: 30000, // 30 seconds
      qaAgentName: undefined, // TODO: Add to board config later
      autoBlockOnWaiting: true,
      enableAutoReview: true,
    };
  }

  /**
   * Rule 1A: Handle human mention in comment - immediate transition to reviewing
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

    // Cancel any pending auto-review transitions
    this.cancelPendingTransition(params.ticketId);

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
   * Rule 1B & 1C: Handle agent work completion - delayed transition to reviewing
   */
  async handleAgentWorkCompletion(params: {
    ticketId: string;
    completedAgentName: string;
  }): Promise<void> {
    const config = this.getWorkflowConfig();
    if (!config.enableAutoReview) return;

    const ticket = await this.ticketStore.getTicketById(params.ticketId);
    if (!ticket || ticket.status === 'reviewing' || ticket.status === 'done' || ticket.status === 'cancelled') {
      return; // Already in review, done, or cancelled
    }

    // Cancel any existing pending transition
    this.cancelPendingTransition(params.ticketId);

    this.logger.info('Scheduling auto-review check after agent completion', {
      ticketId: params.ticketId,
      completedAgent: params.completedAgentName,
      delayMs: config.autoReviewDelayMs,
    });

    // Schedule the transition with delay to allow for cascading mentions
    const timeout = setTimeout(async () => {
      try {
        await this.checkAndTransitionToReview(params.ticketId, params.completedAgentName);
      } catch (error) {
        this.logger.error('Failed to auto-transition ticket to review', {
          ticketId: params.ticketId,
          error: String(error),
        });
      } finally {
        this.pendingTransitions.delete(params.ticketId);
      }
    }, config.autoReviewDelayMs);

    this.pendingTransitions.set(params.ticketId, timeout);
  }

  /**
   * Rule 2A & 2B: Handle agent mention while in reviewing - back to doing
   */
  async handleAgentMentionInReview(params: {
    ticketId: string;
    mentionedAgent: string;
  }): Promise<void> {
    const config = this.getWorkflowConfig();
    if (!config.enableAutoReview) return;

    const ticket = await this.ticketStore.getTicketById(params.ticketId);
    if (!ticket || ticket.status !== 'reviewing') {
      return; // Not in reviewing status
    }

    this.logger.info('Moving ticket from reviewing back to doing due to agent mention', {
      ticketId: params.ticketId,
      mentionedAgent: params.mentionedAgent,
    });

    // Move back to doing and assign to mentioned agent
    const diff = ticket.moveTo('doing');
    const assignDiff = ticket.assign(params.mentionedAgent);
    ticket.blocked = false; // Clear blocked flag

    await this.ticketStore.saveTicket(ticket);
    this.onTicketUpdate?.('ticket:updated', ticket.toDTO());
    await this.ticketStore.saveActivity(TicketActivityEntity.create({
      id: randomUUID(),
      ticketId: params.ticketId,
      action: 'moved_from_review_to_doing',
      changes: { ...diff, ...assignDiff, blocked: { from: true, to: false } },
      actorType: 'agent',
      actorName: 'system',
      source: 'api',
    }));

    this.logger.info('Ticket moved from reviewing to doing', {
      ticketId: params.ticketId,
      assignedTo: params.mentionedAgent,
    });
  }

  /**
   * Handle deliverable creation - check for final status
   */
  async handleDeliverableCreated(params: {
    ticketId: string;
    agentName: string;
    status: 'draft' | 'final';
  }): Promise<void> {
    if (params.status === 'final') {
      // Treat final deliverable as work completion
      await this.handleAgentWorkCompletion({
        ticketId: params.ticketId,
        completedAgentName: params.agentName,
      });
    }
    // Draft deliverables don't trigger auto-review
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

  private async checkAndTransitionToReview(ticketId: string, completedAgentName: string): Promise<void> {
    const config = this.getWorkflowConfig();

    // Re-check ticket status
    const ticket = await this.ticketStore.getTicketById(ticketId);
    if (!ticket || ticket.status === 'reviewing' || ticket.status === 'done' || ticket.status === 'cancelled') {
      return;
    }

    // Check for pending agent mentions (excluding the completed agent)
    const pendingMentions = await this.mentionStore.getByTicket(ticketId);
    const hasPendingAgentWork = pendingMentions.some(
      (mention) =>
        mention.targetType === 'agent' &&
        (mention.status === 'pending' || mention.status === 'acknowledged') &&
        mention.targetAgent !== completedAgentName
    );

    if (hasPendingAgentWork) {
      this.logger.info('Skipping auto-review due to pending agent work', {
        ticketId,
        pendingAgents: pendingMentions
          .filter(m => m.targetType === 'agent' && (m.status === 'pending' || m.status === 'acknowledged'))
          .map(m => m.targetAgent),
      });
      return;
    }

    this.logger.info('Auto-transitioning ticket to review', {
      ticketId,
      completedAgent: completedAgentName,
    });

    // Choose reviewer: QA agent if configured, otherwise default human
    const reviewer = config.qaAgentName || config.defaultReviewer;
    const isQaReview = Boolean(config.qaAgentName);

    // Move to reviewing and assign
    const diff = ticket.moveTo('reviewing');
    const assignDiff = ticket.assign(reviewer);

    await this.ticketStore.saveTicket(ticket);
    this.onTicketUpdate?.('ticket:updated', ticket.toDTO());
    await this.ticketStore.saveActivity(TicketActivityEntity.create({
      id: randomUUID(),
      ticketId,
      action: isQaReview ? 'moved_to_qa_review_auto' : 'moved_to_review_auto',
      changes: { ...diff, ...assignDiff },
      actorType: 'agent',
      actorName: 'system',
      source: 'api',
    }));

    this.logger.info('Ticket auto-transitioned to review', {
      ticketId,
      assignedTo: reviewer,
      reviewType: isQaReview ? 'qa' : 'human',
    });
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

  private cancelPendingTransition(ticketId: string): void {
    const pendingTimeout = this.pendingTransitions.get(ticketId);
    if (pendingTimeout) {
      clearTimeout(pendingTimeout);
      this.pendingTransitions.delete(ticketId);
      this.logger.debug('Cancelled pending auto-review transition', { ticketId });
    }
  }

  /**
   * Cleanup method - should be called on service shutdown
   */
  cleanup(): void {
    for (const [ticketId, timeout] of this.pendingTransitions) {
      clearTimeout(timeout);
      this.logger.debug('Cleaned up pending transition', { ticketId });
    }
    this.pendingTransitions.clear();
  }
}