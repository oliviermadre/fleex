import type { LoggerPort } from '../../application/ports/logger.port.js';
import type { CommentStorePort } from '../../application/ports/comment-store.port.js';
import type { MentionStorePort } from '../../application/ports/mention-store.port.js';
import type { DeliverableStorePort } from '../../application/ports/deliverable-store.port.js';
import type { SkillStorePort } from '../../application/ports/skill-store.port.js';
import type { CachedTicketStore } from '../adapters/cached-ticket-store.js';
import type { CachedPersonaStore } from '../adapters/cached-persona-store.js';
import type { SyncEvent } from './sync-hub-client.js';

type BroadcastFn = (type: string, data: unknown) => void;

export interface RemoteEventHandlerDeps {
  ticketStore: CachedTicketStore;
  personaStore: CachedPersonaStore;
  commentStore: CommentStorePort;
  mentionStore: MentionStorePort;
  deliverableStore: DeliverableStorePort;
  skillStore: SkillStorePort;
  logger: LoggerPort;
}

/**
 * Handles domain events received from other Fleex instances via the Sync Hub.
 *
 * Unlike the DomainEventListener, this does NOT trigger side effects
 * (no agent execution, no auto-review workflow, no waking agents).
 * It only:
 * 1. Reloads affected entities from DB into the local cache
 * 2. Broadcasts updates to local WebSocket clients
 */
export class RemoteEventHandler {
  private ticketBroadcast: BroadcastFn = () => {};
  private personaBroadcast: BroadcastFn = () => {};
  private skillBroadcast: BroadcastFn = () => {};

  constructor(private readonly deps: RemoteEventHandlerDeps) {}

  setTicketBroadcast(fn: BroadcastFn): void { this.ticketBroadcast = fn; }
  setPersonaBroadcast(fn: BroadcastFn): void { this.personaBroadcast = fn; }
  setSkillBroadcast(fn: BroadcastFn): void { this.skillBroadcast = fn; }

  async handle(event: SyncEvent): Promise<void> {
    const { eventType, entityId, secondaryId } = event;

    try {
      switch (eventType) {
        // ── Tickets ──
        case 'ticket.created':
        case 'ticket.updated':
        case 'ticket.moved': {
          const ticket = await this.deps.ticketStore.reloadTicket(entityId);
          if (ticket) {
            const wsType = eventType === 'ticket.created' ? 'ticket:created'
              : eventType === 'ticket.moved' ? 'ticket:moved'
              : 'ticket:updated';
            this.ticketBroadcast(wsType, ticket.toDTO());
          }
          break;
        }
        case 'ticket.deleted':
          this.deps.ticketStore.evictTicket(entityId);
          this.ticketBroadcast('ticket:deleted', { id: entityId });
          break;

        // ── Boards ──
        case 'board.updated': {
          const board = await this.deps.ticketStore.reloadBoard(entityId);
          if (board) this.ticketBroadcast('board:updated', board.toDTO());
          break;
        }
        case 'board.deleted':
          this.deps.ticketStore.evictBoard(entityId);
          this.deps.ticketStore.evictTicketsByBoard(entityId);
          this.ticketBroadcast('board:updated', { deleted: entityId });
          break;

        // ── Comments (not cached, just broadcast) ──
        case 'comment.posted':
        case 'comment.updated': {
          const comment = await this.deps.commentStore.getById(entityId);
          if (comment) {
            const wsType = eventType === 'comment.posted' ? 'comment:created' : 'comment:updated';
            this.ticketBroadcast(wsType, comment.toDTO());
          }
          break;
        }
        case 'comment.deleted':
          this.ticketBroadcast('comment:deleted', { id: entityId, ticketId: secondaryId });
          break;

        // ── Mentions (not cached, just broadcast) ──
        case 'mention.created':
        case 'mention.acknowledged':
        case 'mention.resolved':
        case 'mention.waiting_for_info':
        case 'mention.woken_up': {
          const mention = await this.deps.mentionStore.getById(entityId);
          if (mention) {
            const wsType = eventType === 'mention.created' ? 'mention:created'
              : eventType === 'mention.acknowledged' ? 'mention:acknowledged'
              : eventType === 'mention.resolved' ? 'mention:resolved'
              : eventType === 'mention.waiting_for_info' ? 'mention:waiting_for_info'
              : 'mention:updated';
            this.ticketBroadcast(wsType, mention.toDTO());
          }
          break;
        }
        case 'mention.deleted':
          this.ticketBroadcast('mention:deleted', { id: entityId, ticketId: secondaryId });
          break;

        // ── Deliverables (not cached, just broadcast) ──
        case 'deliverable.created':
        case 'deliverable.updated': {
          const deliverable = await this.deps.deliverableStore.getById(entityId);
          if (deliverable) {
            const wsType = eventType === 'deliverable.created' ? 'deliverable:created' : 'deliverable:updated';
            this.ticketBroadcast(wsType, deliverable.toDTO());
          }
          break;
        }
        case 'deliverable.deleted':
          this.ticketBroadcast('deliverable:deleted', { deliverableId: entityId, ticketId: secondaryId });
          break;

        // ── Personas (cached) ──
        case 'persona.created':
        case 'persona.updated': {
          const persona = await this.deps.personaStore.reloadPersona(entityId);
          if (persona) {
            const wsType = eventType === 'persona.created' ? 'persona:created' : 'persona:updated';
            this.personaBroadcast(wsType, persona.toDTO());
          }
          break;
        }
        case 'persona.deleted':
          this.deps.personaStore.evictPersona(entityId);
          this.personaBroadcast('persona:deleted', { id: entityId });
          break;

        // ── Skills (not cached, just broadcast) ──
        case 'skill.created':
        case 'skill.updated': {
          const skill = await this.deps.skillStore.getById(entityId);
          if (skill) {
            const wsType = eventType === 'skill.created' ? 'skill:created' : 'skill:updated';
            this.skillBroadcast(wsType, skill.toDTO());
          }
          break;
        }
        case 'skill.deleted':
          this.skillBroadcast('skill:deleted', { id: entityId });
          break;

        default:
          this.deps.logger.debug('Unhandled remote sync event', { eventType });
      }
    } catch (err) {
      this.deps.logger.error('Remote event handler failed', {
        eventType,
        entityId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
