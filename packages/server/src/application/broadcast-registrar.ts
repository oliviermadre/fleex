import type { EventBus } from './event-bus.js';
import type { PersonaStorePort } from './ports/persona-store.port.js';
import type { SkillStorePort } from './ports/skill-store.port.js';
import type { TicketStorePort } from './ports/ticket-store.port.js';
import type { MentionStorePort } from './ports/mention-store.port.js';
import type { CommentStorePort } from './ports/comment-store.port.js';
import type { DeliverableStorePort } from './ports/deliverable-store.port.js';
import type { AnyDomainEvent } from '../domain/events.js';

export type BroadcastFn = (type: string, data: unknown) => void;

export interface BroadcastRegistrarDeps {
  personaStore: PersonaStorePort;
  skillStore: SkillStorePort;
  ticketStore: TicketStorePort;
  mentionStore: MentionStorePort;
  commentStore: CommentStorePort;
  deliverableStore: DeliverableStorePort;
}

/**
 * Registers WebSocket broadcast handlers on a given EventBus.
 *
 * Side-effect free: each handler loads the corresponding entity from its store
 * and pushes a DTO to the relevant WS channel. No DB writes, no agent triggers.
 *
 * Used by both the local listener (broadcasts to clients connected to this
 * server) and the remote listener (broadcasts events received from the hub).
 */
export class BroadcastRegistrar {
  private ticketBroadcast: BroadcastFn = () => {};
  private personaBroadcast: BroadcastFn = () => {};
  private skillBroadcast: BroadcastFn = () => {};

  constructor(private readonly deps: BroadcastRegistrarDeps) {}

  setTicketBroadcast(fn: BroadcastFn): void {
    this.ticketBroadcast = fn;
  }

  setPersonaBroadcast(fn: BroadcastFn): void {
    this.personaBroadcast = fn;
  }

  setSkillBroadcast(fn: BroadcastFn): void {
    this.skillBroadcast = fn;
  }

  /** Direct push to the ticket WS channel — for the rare cases where a handler
   * mutates state without going through an event-emitting use-case. */
  pushTicket(type: string, data: unknown): void {
    this.ticketBroadcast(type, data);
  }

  /**
   * Register all broadcast handlers on the given bus.
   *
   * Cache coherence on the remote (hub) path is handled upstream, before the
   * event reaches this bus: see RemoteCacheSync / the onRemoteEvent wiring in
   * the container. By the time a handler reads from a cached store here, the
   * cache has already been re-synced from the source, so handlers stay
   * cache-agnostic and identical for the local and remote paths.
   */
  register(bus: EventBus): void {
    // ── Ticket broadcasts ──
    bus.on('ticket.created', (e) => this.broadcastTicketEntity(e, 'ticket:created'));
    bus.on('ticket.updated', (e) => this.broadcastTicketEntity(e, 'ticket:updated'));
    bus.on('ticket.moved', (e) => this.broadcastTicketEntity(e, 'ticket:moved'));
    bus.on('ticket.deleted', (e) => {
      if (e.type === 'ticket.deleted') {
        this.ticketBroadcast('ticket:deleted', { id: e.ticketId });
      }
    });

    // ── Board broadcasts ──
    bus.on('board.updated', (e) => this.broadcastBoardEntity(e, 'board:updated'));
    bus.on('board.deleted', (e) => {
      if (e.type === 'board.deleted') {
        this.ticketBroadcast('board:updated', { deleted: e.boardId });
      }
    });

    // ── Status model broadcasts ──
    bus.on('status-model.updated', () => this.ticketBroadcast('status-model:updated', {}));

    // ── Comment broadcasts ──
    bus.on('comment.posted', (e) => this.broadcastCommentEntity(e, 'comment:created'));
    bus.on('comment.updated', (e) => this.broadcastCommentEntity(e, 'comment:updated'));
    bus.on('comment.deleted', (e) => {
      if (e.type === 'comment.deleted') {
        this.ticketBroadcast('comment:deleted', { id: e.commentId, ticketId: e.ticketId });
      }
    });

    // ── Mention broadcasts ──
    bus.on('mention.created', (e) => this.broadcastMentionEntity(e, 'mention:created'));
    bus.on('mention.acknowledged', (e) => this.broadcastMentionEntity(e, 'mention:acknowledged'));
    bus.on('mention.resolved', (e) => this.broadcastMentionEntity(e, 'mention:resolved'));
    bus.on('mention.waiting_for_info', (e) => this.broadcastMentionEntity(e, 'mention:waiting_for_info'));
    bus.on('mention.woken_up', (e) => this.broadcastMentionEntity(e, 'mention:updated'));
    bus.on('mention.deleted', (e) => {
      if (e.type === 'mention.deleted') {
        this.ticketBroadcast('mention:deleted', { id: e.mentionId, ticketId: e.ticketId, commentId: e.commentId });
      }
    });
    bus.on('mention.execution_failed', (e) => {
      if (e.type === 'mention.execution_failed') {
        this.ticketBroadcast('mention:execution_failed', {
          mentionId: e.mentionId,
          ticketId: e.ticketId,
          targetAgent: e.targetAgent,
          reason: e.reason,
          message: e.message,
        });
      }
    });

    // ── Deliverable broadcasts ──
    bus.on('deliverable.created', (e) => this.broadcastDeliverableEntity(e, 'deliverable:created'));
    bus.on('deliverable.updated', (e) => this.broadcastDeliverableEntity(e, 'deliverable:updated'));
    bus.on('deliverable.deleted', (e) => {
      if (e.type === 'deliverable.deleted') {
        this.ticketBroadcast('deliverable:deleted', { deliverableId: e.deliverableId, ticketId: e.ticketId });
      }
    });

    // ── Workflow broadcasts ──
    bus.on('workflow.run_created', (e) => {
      if (e.type === 'workflow.run_created') {
        this.ticketBroadcast('workflow:run_created', {
          workflowRunId: e.workflowRunId,
          templateId: e.templateId,
          ticketId: e.ticketId,
        });
      }
    });
    bus.on('workflow.step_started', (e) => {
      if (e.type === 'workflow.step_started') {
        this.ticketBroadcast('workflow:step_started', {
          workflowRunId: e.workflowRunId,
          stepRunId: e.stepRunId,
          stepId: e.stepId,
          ticketId: e.ticketId,
        });
      }
    });
    bus.on('workflow.step_completed', (e) => {
      if (e.type === 'workflow.step_completed') {
        this.ticketBroadcast('workflow:step_completed', {
          workflowRunId: e.workflowRunId,
          stepRunId: e.stepRunId,
          stepId: e.stepId,
          ticketId: e.ticketId,
          nextEdgeId: e.nextEdgeId,
        });
      }
    });
    bus.on('workflow.needs_review', (e) => {
      if (e.type === 'workflow.needs_review') {
        this.ticketBroadcast('workflow:needs_review', {
          workflowRunId: e.workflowRunId,
          stepRunId: e.stepRunId,
          stepId: e.stepId,
          ticketId: e.ticketId,
        });
      }
    });
    bus.on('workflow.run_completed', (e) => {
      if (e.type === 'workflow.run_completed') {
        this.ticketBroadcast('workflow:run_completed', {
          workflowRunId: e.workflowRunId,
          ticketId: e.ticketId,
        });
      }
    });
    bus.on('workflow.run_failed', (e) => {
      if (e.type === 'workflow.run_failed') {
        this.ticketBroadcast('workflow:run_failed', {
          workflowRunId: e.workflowRunId,
          stepRunId: e.stepRunId,
          stepId: e.stepId,
          ticketId: e.ticketId,
          error: e.error,
        });
      }
    });
    bus.on('workflow.run_cancelled', (e) => {
      if (e.type === 'workflow.run_cancelled') {
        this.ticketBroadcast('workflow:run_cancelled', {
          workflowRunId: e.workflowRunId,
          ticketId: e.ticketId,
        });
      }
    });

    // ── Persona broadcasts ──
    bus.on('persona.created', (e) => this.broadcastPersonaEntity(e, 'persona:created'));
    bus.on('persona.updated', (e) => this.broadcastPersonaEntity(e, 'persona:updated'));
    bus.on('persona.deleted', (e) => {
      if (e.type === 'persona.deleted') {
        this.personaBroadcast('persona:deleted', { id: e.personaId });
      }
    });
    bus.on('persona.execution_started', (e) => {
      if (e.type === 'persona.execution_started') {
        this.personaBroadcast('persona:execution_started', {
          personaId: e.personaId,
          mentionIds: e.mentionIds,
        });
      }
    });

    // ── Skill broadcasts ──
    bus.on('skill.created', (e) => this.broadcastSkillEntity(e, 'skill:created'));
    bus.on('skill.updated', (e) => this.broadcastSkillEntity(e, 'skill:updated'));
    bus.on('skill.deleted', (e) => {
      if (e.type === 'skill.deleted') {
        this.skillBroadcast('skill:deleted', { id: e.skillId });
      }
    });
  }

  // ── Entity broadcast helpers ──
  // These load the full entity from the store to broadcast the latest DTO.

  private async broadcastTicketEntity(event: AnyDomainEvent, wsType: string): Promise<void> {
    if (!('ticketId' in event)) return;
    const ticket = await this.deps.ticketStore.getTicketById((event as { ticketId: string }).ticketId);
    if (ticket) this.ticketBroadcast(wsType, ticket.toDTO());
  }

  private async broadcastBoardEntity(event: AnyDomainEvent, wsType: string): Promise<void> {
    if (!('boardId' in event)) return;
    const board = await this.deps.ticketStore.getBoardById((event as { boardId: string }).boardId);
    if (board) this.ticketBroadcast(wsType, board.toDTO());
  }

  private async broadcastCommentEntity(event: AnyDomainEvent, wsType: string): Promise<void> {
    if (!('commentId' in event)) return;
    const comment = await this.deps.commentStore.getById((event as { commentId: string }).commentId);
    if (comment) this.ticketBroadcast(wsType, comment.toDTO());
  }

  private async broadcastMentionEntity(event: AnyDomainEvent, wsType: string): Promise<void> {
    if (!('mentionId' in event)) return;
    const mention = await this.deps.mentionStore.getById((event as { mentionId: string }).mentionId);
    if (mention) this.ticketBroadcast(wsType, mention.toDTO());
  }

  private async broadcastDeliverableEntity(event: AnyDomainEvent, wsType: string): Promise<void> {
    if (!('deliverableId' in event)) return;
    const deliverable = await this.deps.deliverableStore.getById((event as { deliverableId: string }).deliverableId);
    if (deliverable) this.ticketBroadcast(wsType, deliverable.toDTO());
  }

  private async broadcastPersonaEntity(event: AnyDomainEvent, wsType: string): Promise<void> {
    if (!('personaId' in event)) return;
    const persona = await this.deps.personaStore.getById((event as { personaId: string }).personaId);
    if (persona) this.personaBroadcast(wsType, persona.toDTO());
  }

  private async broadcastSkillEntity(event: AnyDomainEvent, wsType: string): Promise<void> {
    if (!('skillId' in event)) return;
    const skill = await this.deps.skillStore.getById((event as { skillId: string }).skillId);
    if (skill) this.skillBroadcast(wsType, skill.toDTO());
  }
}
