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
    it('should unclaim agent and assign human without changing status', async () => {
      // Arrange
      const ticketId = randomUUID();
      const ticket = TicketEntity.create({
        id: ticketId,
        boardId: randomUUID(),
        displayId: 1,
        title: 'Test Ticket',
        status: 'doing',
      });
      ticket.claim('test-agent');

      vi.mocked(ticketStore.getTicketById).mockResolvedValue(ticket);
      vi.mocked(ticketStore.saveTicket).mockResolvedValue();
      vi.mocked(ticketStore.saveActivity).mockResolvedValue();

      // Act
      await useCase.handleHumanMention({
        ticketId,
        mentionedHuman: 'nas',
      });

      // Assert — status unchanged, agent unclaimed, human assigned as 'user'
      expect(ticket.status).toBe('doing');
      expect(ticket.assignee).toBe('user');
      expect(ticket.agentClaimedAt).toBeNull();
      expect(ticketStore.saveTicket).toHaveBeenCalledWith(ticket);
      expect(ticketStore.saveActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'unclaimed_and_assigned_human_via_mention',
        }),
      );
    });

    it('should still work on tickets in reviewing status', async () => {
      // Arrange
      const ticketId = randomUUID();
      const ticket = TicketEntity.create({
        id: ticketId,
        boardId: randomUUID(),
        displayId: 1,
        title: 'Test Ticket',
        status: 'reviewing',
      });
      ticket.claim('test-agent');

      vi.mocked(ticketStore.getTicketById).mockResolvedValue(ticket);
      vi.mocked(ticketStore.saveTicket).mockResolvedValue();
      vi.mocked(ticketStore.saveActivity).mockResolvedValue();

      // Act
      await useCase.handleHumanMention({
        ticketId,
        mentionedHuman: 'nas',
      });

      // Assert — status stays reviewing, but assignment changes to 'user'
      expect(ticket.status).toBe('reviewing');
      expect(ticket.assignee).toBe('user');
      expect(ticketStore.saveTicket).toHaveBeenCalled();
    });

    it('should skip done and cancelled tickets', async () => {
      for (const status of ['done', 'cancelled'] as const) {
        vi.clearAllMocks();
        const ticketId = randomUUID();
        const ticket = TicketEntity.create({
          id: ticketId,
          boardId: randomUUID(),
          displayId: 1,
          title: 'Test Ticket',
          status,
        });

        vi.mocked(ticketStore.getTicketById).mockResolvedValue(ticket);

        await useCase.handleHumanMention({
          ticketId,
          mentionedHuman: 'nas',
        });

        expect(ticketStore.saveTicket).not.toHaveBeenCalled();
        expect(ticketStore.saveActivity).not.toHaveBeenCalled();
      }
    });
  });

  describe('handleAgentWorkCompletion', () => {
    it('should log only and not transition ticket status', async () => {
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
      await useCase.handleAgentWorkCompletion({
        ticketId,
        completedAgentName: 'test-agent',
      });

      // Assert — no auto-transition, status stays as-is
      expect(ticket.status).toBe('doing');
      expect(ticketStore.saveTicket).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        'Agent work completed (no auto-transition)',
        expect.objectContaining({ ticketId }),
      );
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

      // Act
      await useCase.handleAgentWorkCompletion({
        ticketId,
        completedAgentName: 'test-agent',
      });

      // Assert
      expect(ticket.status).toBe('doing'); // Should not change
      expect(ticketStore.saveTicket).not.toHaveBeenCalled();
    });
  });

  describe('handleAgentMentionInReview', () => {
    it('should log only and not move ticket from reviewing', async () => {
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
      await useCase.handleAgentMentionInReview({
        ticketId,
        mentionedAgent: 'test-agent',
      });

      // Assert — no auto-transition, status stays as-is
      expect(ticket.status).toBe('reviewing');
      expect(ticketStore.saveTicket).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        'Agent mentioned in reviewing ticket (no auto-transition)',
        expect.objectContaining({ ticketId }),
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
    it('should log only and not transition for final deliverable', async () => {
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
      await useCase.handleDeliverableCreated({
        ticketId,
        agentName: 'test-agent',
        status: 'final',
      });

      // Assert — no auto-transition
      expect(ticket.status).toBe('doing');
      expect(ticketStore.saveTicket).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        'Deliverable created (no auto-transition)',
        expect.objectContaining({ ticketId, status: 'final' }),
      );
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
});
