import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { AutoReviewWorkflowUseCase } from '../../src/application/use-cases/auto-review-workflow.js';
import { TicketEntity } from '../../src/domain/entities/ticket.entity.js';
import { TicketMentionEntity } from '../../src/domain/entities/ticket-mention.entity.js';
import type { MentionStorePort } from '../../src/application/ports/mention-store.port.js';
import type { TicketStorePort } from '../../src/application/ports/ticket-store.port.js';
import type { LoggerPort } from '../../src/application/ports/logger.port.js';
import type { ConfigPort } from '../../src/application/ports/config.port.js';

describe('AutoReviewWorkflowUseCase', () => {
  let useCase: AutoReviewWorkflowUseCase;
  let mentionStore: MentionStorePort;
  let ticketStore: TicketStorePort;
  let config: ConfigPort;
  let logger: LoggerPort;

  beforeEach(() => {
    mentionStore = {
      getByTicket: vi.fn(),
      getById: vi.fn(),
      getByComment: vi.fn(),
      getPendingForAgent: vi.fn(),
      getPendingCountForTicket: vi.fn(),
      getWaitingByTicket: vi.fn(),
      save: vi.fn(),
      remove: vi.fn(),
    };

    ticketStore = {
      getAllBoards: vi.fn(),
      getBoardById: vi.fn(),
      saveBoard: vi.fn(),
      removeBoard: vi.fn(),
      getAllTickets: vi.fn(),
      getTicketById: vi.fn(),
      getTicketsByBoard: vi.fn(),
      getTicketsByStatus: vi.fn(),
      getTicketsLinkedTo: vi.fn(),
      saveTicket: vi.fn(),
      removeTicket: vi.fn(),
      removeTicketsByBoard: vi.fn(),
      getNextDisplayId: vi.fn(),
      getNextTicketForAgent: vi.fn(),
      getClaimedByAgent: vi.fn(),
      saveActivity: vi.fn(),
      getActivitiesByTicket: vi.fn(),
    };

    config = {
      get: vi.fn().mockReturnValue({
        humanMentionName: 'nas',
        humanDisplayName: 'NaS',
      }),
      update: vi.fn(),
    };

    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    useCase = new AutoReviewWorkflowUseCase(mentionStore, ticketStore, config, logger);
  });

  describe('handleHumanMention', () => {
    it('should move ticket to reviewing when human is mentioned', async () => {
      // Arrange
      const ticketId = randomUUID();
      const ticket = TicketEntity.create({
        id: ticketId,
        boardId: randomUUID(),
        displayId: 1,
        title: 'Test Ticket',
        status: 'doing',
      });

      vi.mocked(ticketStore.getTicketById).mockResolvedValue(ticket);
      vi.mocked(ticketStore.saveTicket).mockResolvedValue();
      vi.mocked(ticketStore.saveActivity).mockResolvedValue();

      // Act
      await useCase.handleHumanMention({
        ticketId,
        mentionedHuman: 'nas',
      });

      // Assert
      expect(ticket.status).toBe('reviewing');
      expect(ticket.assignee).toBe('nas');
      expect(ticketStore.saveTicket).toHaveBeenCalledWith(ticket);
      expect(ticketStore.saveActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'moved_to_review_via_human_mention',
        }),
      );
    });

    it('should not move ticket if already in reviewing or done', async () => {
      // Arrange
      const ticketId = randomUUID();
      const ticket = TicketEntity.create({
        id: ticketId,
        boardId: randomUUID(),
        displayId: 1,
        title: 'Test Ticket',
        status: 'reviewing',
      });

      vi.mocked(ticketStore.getTicketById).mockResolvedValue(ticket);

      // Act
      await useCase.handleHumanMention({
        ticketId,
        mentionedHuman: 'nas',
      });

      // Assert
      expect(ticketStore.saveTicket).not.toHaveBeenCalled();
      expect(ticketStore.saveActivity).not.toHaveBeenCalled();
    });
  });

  describe('handleAgentWorkCompletion', () => {
    it('should schedule auto-review transition after delay', async () => {
      // Arrange
      const ticketId = randomUUID();
      const ticket = TicketEntity.create({
        id: ticketId,
        boardId: randomUUID(),
        displayId: 1,
        title: 'Test Ticket',
        status: 'doing',
      });

      vi.mocked(ticketStore.getTicketById).mockResolvedValue(ticket);
      vi.mocked(mentionStore.getByTicket).mockResolvedValue([]);
      vi.mocked(ticketStore.saveTicket).mockResolvedValue();
      vi.mocked(ticketStore.saveActivity).mockResolvedValue();

      vi.useFakeTimers();

      // Act
      await useCase.handleAgentWorkCompletion({
        ticketId,
        completedAgentName: 'test-agent',
      });

      // Fast-forward time to trigger the timeout
      vi.advanceTimersByTime(30000);

      // Wait for async operations to complete
      await new Promise(resolve => process.nextTick(resolve));

      // Assert
      expect(ticket.status).toBe('reviewing');
      expect(ticket.assignee).toBe('nas');
      expect(ticketStore.saveTicket).toHaveBeenCalledWith(ticket);
      expect(ticketStore.saveActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'moved_to_review_auto',
        }),
      );

      vi.useRealTimers();
    });

    it('should not auto-transition if pending agent work exists', async () => {
      // Arrange
      const ticketId = randomUUID();
      const ticket = TicketEntity.create({
        id: ticketId,
        boardId: randomUUID(),
        displayId: 1,
        title: 'Test Ticket',
        status: 'doing',
      });

      const pendingMention = TicketMentionEntity.create({
        id: randomUUID(),
        ticketId,
        commentId: randomUUID(),
        targetAgent: 'other-agent',
        sourceAgent: 'test-agent',
        targetType: 'agent',
      });

      vi.mocked(ticketStore.getTicketById).mockResolvedValue(ticket);
      vi.mocked(mentionStore.getByTicket).mockResolvedValue([pendingMention]);

      vi.useFakeTimers();

      // Act
      await useCase.handleAgentWorkCompletion({
        ticketId,
        completedAgentName: 'test-agent',
      });

      // Fast-forward time
      vi.advanceTimersByTime(30000);
      await new Promise(resolve => process.nextTick(resolve));

      // Assert
      expect(ticket.status).toBe('doing'); // Should not change
      expect(ticketStore.saveTicket).not.toHaveBeenCalled();

      vi.useRealTimers();
    });
  });

  describe('handleAgentMentionInReview', () => {
    it('should move ticket from reviewing back to doing', async () => {
      // Arrange
      const ticketId = randomUUID();
      const ticket = TicketEntity.create({
        id: ticketId,
        boardId: randomUUID(),
        displayId: 1,
        title: 'Test Ticket',
        status: 'reviewing',
      });

      vi.mocked(ticketStore.getTicketById).mockResolvedValue(ticket);
      vi.mocked(ticketStore.saveTicket).mockResolvedValue();
      vi.mocked(ticketStore.saveActivity).mockResolvedValue();

      // Act
      await useCase.handleAgentMentionInReview({
        ticketId,
        mentionedAgent: 'test-agent',
      });

      // Assert
      expect(ticket.status).toBe('doing');
      expect(ticket.assignee).toBe('test-agent');
      expect(ticket.blocked).toBe(false);
      expect(ticketStore.saveTicket).toHaveBeenCalledWith(ticket);
      expect(ticketStore.saveActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'moved_from_review_to_doing',
        }),
      );
    });

    it('should not move ticket if not in reviewing status', async () => {
      // Arrange
      const ticketId = randomUUID();
      const ticket = TicketEntity.create({
        id: ticketId,
        boardId: randomUUID(),
        displayId: 1,
        title: 'Test Ticket',
        status: 'doing',
      });

      vi.mocked(ticketStore.getTicketById).mockResolvedValue(ticket);

      // Act
      await useCase.handleAgentMentionInReview({
        ticketId,
        mentionedAgent: 'test-agent',
      });

      // Assert
      expect(ticketStore.saveTicket).not.toHaveBeenCalled();
      expect(ticketStore.saveActivity).not.toHaveBeenCalled();
    });
  });

  describe('handleDeliverableCreated', () => {
    it('should trigger auto-review for final deliverable', async () => {
      // Arrange
      const ticketId = randomUUID();
      const ticket = TicketEntity.create({
        id: ticketId,
        boardId: randomUUID(),
        displayId: 1,
        title: 'Test Ticket',
        status: 'doing',
      });

      vi.mocked(ticketStore.getTicketById).mockResolvedValue(ticket);
      vi.mocked(mentionStore.getByTicket).mockResolvedValue([]);
      vi.mocked(ticketStore.saveTicket).mockResolvedValue();
      vi.mocked(ticketStore.saveActivity).mockResolvedValue();

      vi.useFakeTimers();

      // Act
      await useCase.handleDeliverableCreated({
        ticketId,
        agentName: 'test-agent',
        status: 'final',
      });

      // Fast-forward time
      vi.advanceTimersByTime(30000);
      await new Promise(resolve => process.nextTick(resolve));

      // Assert
      expect(ticket.status).toBe('reviewing');
      expect(ticketStore.saveTicket).toHaveBeenCalledWith(ticket);

      vi.useRealTimers();
    });

    it('should not trigger auto-review for draft deliverable', async () => {
      // Arrange
      const ticketId = randomUUID();

      // Act
      await useCase.handleDeliverableCreated({
        ticketId,
        agentName: 'test-agent',
        status: 'draft',
      });

      // Assert
      expect(ticketStore.getTicketById).not.toHaveBeenCalled();
    });
  });

  describe('cleanup', () => {
    it('should clear all pending transitions', async () => {
      // Arrange
      const ticketId = randomUUID();
      const ticket = TicketEntity.create({
        id: ticketId,
        boardId: randomUUID(),
        displayId: 1,
        title: 'Test Ticket',
        status: 'doing',
      });

      vi.mocked(ticketStore.getTicketById).mockResolvedValue(ticket);
      vi.mocked(mentionStore.getByTicket).mockResolvedValue([]);
      vi.mocked(ticketStore.saveTicket).mockResolvedValue();
      vi.mocked(ticketStore.saveActivity).mockResolvedValue();

      vi.useFakeTimers();

      // Schedule a transition
      await useCase.handleAgentWorkCompletion({
        ticketId,
        completedAgentName: 'test-agent',
      });

      // Clear the mock call counts from the initial setup
      vi.mocked(ticketStore.getTicketById).mockClear();
      vi.mocked(ticketStore.saveTicket).mockClear();
      vi.mocked(ticketStore.saveActivity).mockClear();

      // Act - cleanup should cancel the pending timeout
      useCase.cleanup();

      // Fast-forward time - the delayed execution should not happen
      vi.advanceTimersByTime(30000);
      await new Promise(resolve => process.nextTick(resolve));

      // Assert - no delayed operations should have been called after cleanup
      expect(ticketStore.getTicketById).not.toHaveBeenCalled();
      expect(ticketStore.saveTicket).not.toHaveBeenCalled();
      expect(ticketStore.saveActivity).not.toHaveBeenCalled();

      vi.useRealTimers();
    });
  });
});