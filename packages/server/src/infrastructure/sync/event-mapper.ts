import type { AnyDomainEvent } from '../../domain/events.js';
import type { SyncEvent } from './sync-hub-client.js';

/**
 * Maps a domain event to a lightweight SyncEvent for relay via the sync hub.
 * Returns null for events that don't need cross-instance sync
 * (session events, worktree events — these are local to the machine).
 */
export function mapDomainEventToSync(event: AnyDomainEvent): SyncEvent | null {
  switch (event.type) {
    // ── Tickets ──
    case 'ticket.created':
    case 'ticket.updated':
    case 'ticket.moved':
    case 'ticket.deleted':
      return { eventType: event.type, entityId: event.ticketId };

    // ── Boards ──
    case 'board.updated':
    case 'board.deleted':
      return { eventType: event.type, entityId: event.boardId };

    // ── Comments ──
    case 'comment.posted':
    case 'comment.updated':
      return { eventType: event.type, entityId: event.commentId, secondaryId: event.ticketId };
    case 'comment.deleted':
      return { eventType: event.type, entityId: event.commentId, secondaryId: event.ticketId };

    // ── Mentions ──
    case 'mention.created':
    case 'mention.acknowledged':
    case 'mention.resolved':
    case 'mention.waiting_for_info':
    case 'mention.woken_up':
      return { eventType: event.type, entityId: event.mentionId, secondaryId: event.ticketId };
    case 'mention.deleted':
      return { eventType: event.type, entityId: event.mentionId, secondaryId: event.ticketId };

    // ── Deliverables ──
    case 'deliverable.created':
    case 'deliverable.updated':
      return { eventType: event.type, entityId: event.deliverableId, secondaryId: event.ticketId };
    case 'deliverable.deleted':
      return { eventType: event.type, entityId: event.deliverableId, secondaryId: event.ticketId };

    // ── Personas ──
    case 'persona.created':
    case 'persona.updated':
    case 'persona.deleted':
      return { eventType: event.type, entityId: event.personaId };
    case 'persona.execution_started':
      return { eventType: event.type, entityId: event.personaId };

    // ── Skills ──
    case 'skill.created':
    case 'skill.updated':
    case 'skill.deleted':
      return { eventType: event.type, entityId: event.skillId };

    // ── Panel events ──
    case 'panel.created':
    case 'panel.updated':
    case 'panel.deleted':
    case 'panel.executed':
      return { eventType: event.type, entityId: event.panelId };

    // ── Ticket groups ──
    case 'ticketGroup.created':
    case 'ticketGroup.updated':
    case 'ticketGroup.deleted':
      return { eventType: event.type, entityId: event.groupId };
    case 'ticketGroup.memberAdded':
    case 'ticketGroup.memberRemoved':
      return { eventType: event.type, entityId: event.groupId, secondaryId: event.ticketId };
    case 'ticketGroup.boardAdded':
    case 'ticketGroup.boardRemoved':
      return { eventType: event.type, entityId: event.groupId, secondaryId: event.boardId };

    // ── Ticket relationships ──
    case 'ticketRelationship.created':
    case 'ticketRelationship.deleted':
      return { eventType: event.type, entityId: event.parentId, secondaryId: event.childId };

    // ── Local-only events (no sync needed) ──
    case 'session.created':
    case 'session.renamed':
    case 'session.killed':
    case 'worktree.created':
    case 'skill.executed':
      return null;

    default:
      return null;
  }
}
