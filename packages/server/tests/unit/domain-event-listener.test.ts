import { randomUUID } from 'node:crypto';

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { DomainEventListener } from '../../src/application/domain-event-listener.js';
import { EventBus } from '../../src/application/event-bus.js';
import { AgentPersonaEntity } from '../../src/domain/entities/agent-persona.entity.js';
import { TicketCommentEntity } from '../../src/domain/entities/ticket-comment.entity.js';
import { TicketDeliverableEntity } from '../../src/domain/entities/ticket-deliverable.entity.js';
import { TicketMentionEntity } from '../../src/domain/entities/ticket-mention.entity.js';
import { TicketEntity } from '../../src/domain/entities/ticket.entity.js';

import type { CommentStorePort } from '../../src/application/ports/comment-store.port.js';
import type { DeliverableStorePort } from '../../src/application/ports/deliverable-store.port.js';
import type { LoggerPort } from '../../src/application/ports/logger.port.js';
import type { MentionStorePort } from '../../src/application/ports/mention-store.port.js';
import type { PersonaStorePort } from '../../src/application/ports/persona-store.port.js';
import type { TicketStorePort } from '../../src/application/ports/ticket-store.port.js';
import type { AutoReviewWorkflowUseCase } from '../../src/application/use-cases/auto-review-workflow.js';
import type { ExecuteAgentUseCase } from '../../src/application/use-cases/execute-agent.js';
import type { WakeWaitingAgentsUseCase } from '../../src/application/use-cases/wake-waiting-agents.js';

function createMocks() {
  const personaStore: PersonaStorePort = {
    getAll: vi.fn(),
    getById: vi.fn(),
    getByName: vi.fn(),
    save: vi.fn(),
    remove: vi.fn(),
  };

  const ticketStore = {
    getAllBoards: vi.fn(),
    getBoardById: vi.fn(),
    saveBoard: vi.fn(),
    removeBoard: vi.fn(),
    getAllTickets: vi.fn(),
    getTicketById: vi.fn(),
    getTicketsByBoard: vi.fn(),
    getTicketsByStatus: vi.fn(),
    getTicketsLinkedTo: vi.fn(),
    createTicket: vi.fn(),
    saveTicket: vi.fn(),
    removeTicket: vi.fn(),
    removeTicketsByBoard: vi.fn(),
    getNextTicketForAgent: vi.fn(),
    getClaimedByAgent: vi.fn(),
    saveActivity: vi.fn(),
    getActivitiesByTicket: vi.fn(),
  } as unknown as TicketStorePort;

  const mentionStore = {
    getByTicket: vi.fn(),
    getById: vi.fn(),
    getByComment: vi.fn(),
    getPendingForAgent: vi.fn(),
    getPendingCountForTicket: vi.fn(),
    getWaitingByTicket: vi.fn(),
    save: vi.fn(),
    remove: vi.fn(),
  } as unknown as MentionStorePort;

  const commentStore = {
    getByTicket: vi.fn(),
    getById: vi.fn(),
    save: vi.fn(),
    remove: vi.fn(),
  } as unknown as CommentStorePort;

  const deliverableStore = {
    getByTicket: vi.fn(),
    getById: vi.fn(),
    save: vi.fn(),
  } as unknown as DeliverableStorePort;

  const autoReviewWorkflow = {
    handleHumanMention: vi.fn().mockResolvedValue(undefined),
    handleAgentMentionInReview: vi.fn().mockResolvedValue(undefined),
    handleAgentWorkCompletion: vi.fn().mockResolvedValue(undefined),
    handleDeliverableCreated: vi.fn().mockResolvedValue(undefined),
    handleMentionWaitingForInfo: vi.fn().mockResolvedValue(undefined),
    handleTicketDone: vi.fn().mockResolvedValue(undefined),
    handleHumanCommentPosted: vi.fn().mockResolvedValue(undefined),
    onTicketUpdate: null,
    cleanup: vi.fn(),
  } as unknown as AutoReviewWorkflowUseCase;

  const executeAgent = {
    execute: vi.fn().mockResolvedValue({ status: 'started', mentionIds: [] }),
  } as unknown as ExecuteAgentUseCase;

  const wakeWaitingAgents = {
    execute: vi.fn().mockResolvedValue(undefined),
  } as unknown as WakeWaitingAgentsUseCase;

  const logger: LoggerPort = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  return {
    personaStore,
    ticketStore,
    mentionStore,
    commentStore,
    deliverableStore,
    autoReviewWorkflow,
    executeAgent,
    wakeWaitingAgents,
    logger,
  };
}

describe('DomainEventListener', () => {
  let eventBus: EventBus;
  let listener: DomainEventListener;
  let mocks: ReturnType<typeof createMocks>;
  let ticketBroadcast: ReturnType<typeof vi.fn>;
  let personaBroadcast: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    eventBus = new EventBus();
    mocks = createMocks();
    listener = new DomainEventListener({ eventBus, ...mocks });

    ticketBroadcast = vi.fn();
    personaBroadcast = vi.fn();
    listener.setTicketBroadcast(ticketBroadcast);
    listener.setPersonaBroadcast(personaBroadcast);

    listener.register();
  });

  describe('broadcasting', () => {
    it('should broadcast ticket.created via ticketBroadcast', async () => {
      const ticketId = randomUUID();
      const ticket = TicketEntity.create({
        id: ticketId,
        boardId: randomUUID(),
        displayId: 1,
        title: 'Test',
      });
      vi.mocked(mocks.ticketStore.getTicketById).mockResolvedValue(ticket);

      eventBus.emit({
        type: 'ticket.created',
        ticketId,
        boardId: ticket.boardId,
        occurredAt: new Date(),
      });
      await new Promise((r) => setTimeout(r, 10));

      expect(ticketBroadcast).toHaveBeenCalledWith('ticket:created', ticket.toDTO());
    });

    it('should broadcast ticket.deleted with id payload', async () => {
      const ticketId = randomUUID();

      eventBus.emit({ type: 'ticket.deleted', ticketId, occurredAt: new Date() });
      await new Promise((r) => setTimeout(r, 10));

      expect(ticketBroadcast).toHaveBeenCalledWith('ticket:deleted', { id: ticketId });
    });

    it('should broadcast mention.created via ticketBroadcast', async () => {
      const mentionId = randomUUID();
      const ticketId = randomUUID();
      const mention = TicketMentionEntity.create({
        id: mentionId,
        ticketId,
        commentId: randomUUID(),
        targetAgent: 'agent-a',
        sourceAgent: 'user',
      });
      vi.mocked(mocks.mentionStore.getById).mockResolvedValue(mention);

      eventBus.emit({
        type: 'mention.created',
        mentionId,
        ticketId,
        targetAgent: 'agent-a',
        targetType: 'agent',
        sourceAgent: 'user',
        occurredAt: new Date(),
      });
      await new Promise((r) => setTimeout(r, 10));

      expect(ticketBroadcast).toHaveBeenCalledWith('mention:created', mention.toDTO());
    });

    it('should broadcast mention.execution_failed with reason and message', async () => {
      const mentionId = randomUUID();
      const ticketId = randomUUID();

      eventBus.emit({
        type: 'mention.execution_failed',
        mentionId,
        ticketId,
        targetAgent: 'tldr',
        reason: 'startup_error',
        message: 'Could not create workspace directory for ticket',
        occurredAt: new Date(),
      });
      await new Promise((r) => setTimeout(r, 10));

      expect(ticketBroadcast).toHaveBeenCalledWith('mention:execution_failed', {
        mentionId,
        ticketId,
        targetAgent: 'tldr',
        reason: 'startup_error',
        message: 'Could not create workspace directory for ticket',
      });
    });

    // WHY: the ephemeral mention:execution_failed event is gone after a reload,
    // so the crash card must be driven by durable status. The handler pairs the
    // event with a mention:updated carrying the persisted `failed` status — this
    // is what keeps the card visible across a cold reload (the ticket's core bug).
    it('should also broadcast the companion mention:updated with the failed status', async () => {
      const mentionId = randomUUID();
      const ticketId = randomUUID();
      const mention = TicketMentionEntity.create({
        id: mentionId,
        ticketId,
        commentId: randomUUID(),
        targetAgent: 'tldr',
        sourceAgent: 'user',
      });
      mention.acknowledge();
      mention.markFailed();
      expect(mention.status).toBe('failed');
      vi.mocked(mocks.mentionStore.getById).mockResolvedValue(mention);

      eventBus.emit({
        type: 'mention.execution_failed',
        mentionId,
        ticketId,
        targetAgent: 'tldr',
        reason: 'usage_limit',
        message: "Quota d'usage épuisé.",
        occurredAt: new Date(),
      });
      await new Promise((r) => setTimeout(r, 10));

      expect(ticketBroadcast).toHaveBeenCalledWith('mention:updated', mention.toDTO());
    });

    it('should broadcast persona.created via personaBroadcast', async () => {
      const personaId = randomUUID();
      const persona = AgentPersonaEntity.create({
        id: personaId,
        name: 'test-agent',
        displayName: 'Test Agent',
      });
      vi.mocked(mocks.personaStore.getById).mockResolvedValue(persona);

      eventBus.emit({ type: 'persona.created', personaId, occurredAt: new Date() });
      await new Promise((r) => setTimeout(r, 10));

      expect(personaBroadcast).toHaveBeenCalledWith('persona:created', persona.toDTO());
    });
  });

  describe('auto-trigger agents', () => {
    it('should auto-trigger agent execution when agent mention is created', async () => {
      const persona = AgentPersonaEntity.create({
        id: randomUUID(),
        name: 'target-agent',
        displayName: 'Target',
      });
      vi.mocked(mocks.personaStore.getByName).mockResolvedValue(persona);
      // Mock getById for broadcast
      vi.mocked(mocks.mentionStore.getById).mockResolvedValue(null);

      eventBus.emit({
        type: 'mention.created',
        mentionId: randomUUID(),
        ticketId: randomUUID(),
        targetAgent: 'target-agent',
        targetType: 'agent',
        sourceAgent: 'user',
        occurredAt: new Date(),
      });
      await new Promise((r) => setTimeout(r, 10));

      expect(mocks.personaStore.getByName).toHaveBeenCalledWith('target-agent');
      expect(mocks.executeAgent.execute).toHaveBeenCalledWith(persona.id);
    });

    it('should not trigger execution for human mentions', async () => {
      vi.mocked(mocks.mentionStore.getById).mockResolvedValue(null);

      eventBus.emit({
        type: 'mention.created',
        mentionId: randomUUID(),
        ticketId: randomUUID(),
        targetAgent: 'human-user',
        targetType: 'human',
        sourceAgent: 'agent-a',
        occurredAt: new Date(),
      });
      await new Promise((r) => setTimeout(r, 10));

      expect(mocks.executeAgent.execute).not.toHaveBeenCalled();
    });
  });

  describe('auto-review workflow', () => {
    it('should trigger handleHumanMention for human mentions in comments', async () => {
      vi.mocked(mocks.commentStore.getById).mockResolvedValue(null);

      eventBus.emit({
        type: 'comment.posted',
        commentId: randomUUID(),
        ticketId: 't1',
        authorType: 'agent',
        authorName: 'agent-a',
        createdMentions: [{ mentionId: 'm1', targetAgent: 'nas', targetType: 'human' }],
        occurredAt: new Date(),
      });
      await new Promise((r) => setTimeout(r, 10));

      expect(mocks.autoReviewWorkflow.handleHumanMention).toHaveBeenCalledWith({
        ticketId: 't1',
        mentionedHuman: 'nas',
      });
    });

    it('should trigger handleAgentMentionInReview for agent mentions in comments', async () => {
      vi.mocked(mocks.commentStore.getById).mockResolvedValue(null);

      eventBus.emit({
        type: 'comment.posted',
        commentId: randomUUID(),
        ticketId: 't1',
        authorType: 'user',
        authorName: 'user',
        createdMentions: [{ mentionId: 'm1', targetAgent: 'agent-b', targetType: 'agent' }],
        occurredAt: new Date(),
      });
      await new Promise((r) => setTimeout(r, 10));

      expect(mocks.autoReviewWorkflow.handleAgentMentionInReview).toHaveBeenCalledWith({
        ticketId: 't1',
        mentionedAgent: 'agent-b',
      });
    });

    it('should trigger handleAgentWorkCompletion on mention.resolved', async () => {
      vi.mocked(mocks.mentionStore.getById).mockResolvedValue(null);

      eventBus.emit({
        type: 'mention.resolved',
        mentionId: 'm1',
        ticketId: 't1',
        targetAgent: 'agent-a',
        resolvedBy: 'agent-a',
        occurredAt: new Date(),
      });
      await new Promise((r) => setTimeout(r, 10));

      expect(mocks.autoReviewWorkflow.handleAgentWorkCompletion).toHaveBeenCalledWith({
        ticketId: 't1',
        completedAgentName: 'agent-a',
      });
    });

    it('should trigger handleMentionWaitingForInfo on mention.waiting_for_info', async () => {
      vi.mocked(mocks.mentionStore.getById).mockResolvedValue(null);

      eventBus.emit({
        type: 'mention.waiting_for_info',
        mentionId: 'm1',
        ticketId: 't1',
        targetAgent: 'agent-a',
        occurredAt: new Date(),
      });
      await new Promise((r) => setTimeout(r, 10));

      expect(mocks.autoReviewWorkflow.handleMentionWaitingForInfo).toHaveBeenCalledWith({
        ticketId: 't1',
        agentName: 'agent-a',
      });
    });

    it('should trigger handleDeliverableCreated for final deliverables', async () => {
      vi.mocked(mocks.deliverableStore.getById).mockResolvedValue(null);

      eventBus.emit({
        type: 'deliverable.created',
        deliverableId: 'd1',
        ticketId: 't1',
        agentName: 'agent-a',
        status: 'final',
        title: 'Deliverable d1',
        occurredAt: new Date(),
      });
      await new Promise((r) => setTimeout(r, 10));

      expect(mocks.autoReviewWorkflow.handleDeliverableCreated).toHaveBeenCalledWith({
        ticketId: 't1',
        agentName: 'agent-a',
        status: 'final',
      });
    });

    it('should trigger handleTicketDone when ticket moves to done', async () => {
      vi.mocked(mocks.ticketStore.getTicketById).mockResolvedValue(null);

      eventBus.emit({
        type: 'ticket.moved',
        ticketId: 't1',
        fromStatus: 'doing',
        toStatus: 'done',
        occurredAt: new Date(),
      });
      await new Promise((r) => setTimeout(r, 10));

      expect(mocks.autoReviewWorkflow.handleTicketDone).toHaveBeenCalledWith({ ticketId: 't1' });
    });

    it('should NOT trigger handleTicketDone for non-done moves', async () => {
      vi.mocked(mocks.ticketStore.getTicketById).mockResolvedValue(null);

      eventBus.emit({
        type: 'ticket.moved',
        ticketId: 't1',
        fromStatus: 'backlog',
        toStatus: 'doing',
        occurredAt: new Date(),
      });
      await new Promise((r) => setTimeout(r, 10));

      expect(mocks.autoReviewWorkflow.handleTicketDone).not.toHaveBeenCalled();
    });
  });

  describe('wake waiting agents', () => {
    it('should wake waiting agents when a user comment is posted', async () => {
      vi.mocked(mocks.commentStore.getById).mockResolvedValue(null);

      eventBus.emit({
        type: 'comment.posted',
        commentId: randomUUID(),
        ticketId: 't1',
        authorType: 'user',
        authorName: 'human',
        createdMentions: [],
        occurredAt: new Date(),
      });
      await new Promise((r) => setTimeout(r, 10));

      expect(mocks.wakeWaitingAgents.execute).toHaveBeenCalledWith('t1', []);
    });

    it('should exclude agent from wake when agent posts comment', async () => {
      vi.mocked(mocks.commentStore.getById).mockResolvedValue(null);

      eventBus.emit({
        type: 'comment.posted',
        commentId: randomUUID(),
        ticketId: 't1',
        authorType: 'agent',
        authorName: 'agent-a',
        createdMentions: [],
        occurredAt: new Date(),
      });
      await new Promise((r) => setTimeout(r, 10));

      expect(mocks.wakeWaitingAgents.execute).toHaveBeenCalledWith('t1', ['agent-a']);
    });

    it('wakes a re-mentioned agent when it is NOT in wakeExcludeAgents (answer case)', async () => {
      // "answer" disambiguation: the duplicate mention is suppressed in the
      // comment route and the agent is left out of wakeExcludeAgents, so it is
      // woken here and fed the comment.
      vi.mocked(mocks.commentStore.getById).mockResolvedValue(null);

      eventBus.emit({
        type: 'comment.posted',
        commentId: randomUUID(),
        ticketId: 't1',
        authorType: 'user',
        authorName: 'human',
        createdMentions: [],
        occurredAt: new Date(),
      });
      await new Promise((r) => setTimeout(r, 10));

      expect(mocks.wakeWaitingAgents.execute).toHaveBeenCalledWith('t1', []);
    });

    it('does NOT wake an agent listed in wakeExcludeAgents (new subject)', async () => {
      // "new subject" disambiguation: the agent keeps waiting for its answer; the
      // comment must not wake it.
      vi.mocked(mocks.commentStore.getById).mockResolvedValue(null);

      eventBus.emit({
        type: 'comment.posted',
        commentId: randomUUID(),
        ticketId: 't1',
        authorType: 'user',
        authorName: 'human',
        createdMentions: [{ mentionId: randomUUID(), targetAgent: 'agent-a', targetType: 'agent' }],
        wakeExcludeAgents: ['agent-a'],
        occurredAt: new Date(),
      });
      await new Promise((r) => setTimeout(r, 10));

      expect(mocks.wakeWaitingAgents.execute).toHaveBeenCalledWith('t1', ['agent-a']);
    });
  });

  describe('auto-resolve human mentions', () => {
    it('should auto-resolve human mentions when user posts comment', async () => {
      vi.mocked(mocks.commentStore.getById).mockResolvedValue(null);

      eventBus.emit({
        type: 'comment.posted',
        commentId: randomUUID(),
        ticketId: 't1',
        authorType: 'user',
        authorName: 'human',
        createdMentions: [],
        occurredAt: new Date(),
      });
      await new Promise((r) => setTimeout(r, 10));

      expect(mocks.autoReviewWorkflow.handleHumanCommentPosted).toHaveBeenCalledWith({
        ticketId: 't1',
      });
    });

    it('should NOT auto-resolve human mentions when agent posts comment', async () => {
      vi.mocked(mocks.commentStore.getById).mockResolvedValue(null);

      eventBus.emit({
        type: 'comment.posted',
        commentId: randomUUID(),
        ticketId: 't1',
        authorType: 'agent',
        authorName: 'agent-a',
        createdMentions: [],
        occurredAt: new Date(),
      });
      await new Promise((r) => setTimeout(r, 10));

      expect(mocks.autoReviewWorkflow.handleHumanCommentPosted).not.toHaveBeenCalled();
    });
  });

  describe('deliverable updated workflow', () => {
    it('should trigger auto-review when deliverable status changes to final', async () => {
      vi.mocked(mocks.deliverableStore.getById).mockResolvedValue(null);

      eventBus.emit({
        type: 'deliverable.updated',
        deliverableId: 'd1',
        ticketId: 't1',
        agentName: 'agent-a',
        oldStatus: 'draft',
        newStatus: 'final',
        title: 'Deliverable d1',
        occurredAt: new Date(),
      });
      await new Promise((r) => setTimeout(r, 10));

      expect(mocks.autoReviewWorkflow.handleDeliverableCreated).toHaveBeenCalledWith({
        ticketId: 't1',
        agentName: 'agent-a',
        status: 'final',
      });
    });

    it('should NOT trigger auto-review when deliverable stays draft', async () => {
      vi.mocked(mocks.deliverableStore.getById).mockResolvedValue(null);

      eventBus.emit({
        type: 'deliverable.updated',
        deliverableId: 'd1',
        ticketId: 't1',
        agentName: 'agent-a',
        oldStatus: 'draft',
        newStatus: 'draft',
        title: 'Deliverable d1',
        occurredAt: new Date(),
      });
      await new Promise((r) => setTimeout(r, 10));

      expect(mocks.autoReviewWorkflow.handleDeliverableCreated).not.toHaveBeenCalled();
    });
  });
});
