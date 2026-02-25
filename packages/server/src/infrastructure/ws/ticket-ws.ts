import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import type { DomainEvent } from '@asm/shared';
import { WS_TICKET_PATH } from '@asm/shared';
import type { Container } from '../container.js';

// Map domain event types to legacy WS message types for frontend compatibility
const EVENT_TO_WS_TYPE: Record<string, string> = {
  'ticket.created': 'ticket:created',
  'ticket.updated': 'ticket:updated',
  'ticket.moved': 'ticket:moved',
  'ticket.deleted': 'ticket:deleted',
  'ticket.claimed': 'ticket:updated',
  'ticket.unclaimed': 'ticket:updated',
  'ticket.assigned': 'ticket:updated',
  'ticket.unassigned': 'ticket:updated',
  'ticket.completed': 'ticket:moved',
  'ticket.linked': 'ticket:updated',
  'ticket.unlinked': 'ticket:updated',
  'ticket.imported': 'ticket:created',
  'ticket.githubSynced': 'ticket:updated',
  'board.created': 'board:updated',
  'board.updated': 'board:updated',
  'board.deleted': 'board:updated',
  'comment.created': 'comment:created',
  'comment.updated': 'comment:updated',
  'comment.deleted': 'comment:deleted',
  'mention.created': 'mention:created',
  'mention.acknowledged': 'mention:acknowledged',
  'mention.resolved': 'mention:resolved',
  'deliverable.created': 'deliverable:created',
  'deliverable.updated': 'deliverable:updated',
};

// Extract the WS-compatible data payload from a domain event
function extractWsData(event: DomainEvent): unknown {
  const payload = event.payload as Record<string, unknown>;
  // For ticket events that wrap { ticket, changes }, send just the ticket DTO
  if ('ticket' in payload && 'changes' in payload) {
    return payload.ticket;
  }
  // For deleted events, keep { id }
  if (event.type === 'ticket.deleted') {
    return payload;
  }
  // For board.deleted, convert to legacy format
  if (event.type === 'board.deleted') {
    return { deleted: (payload as { id: string }).id };
  }
  return payload;
}

export function ticketWsPlugin(container: Container) {
  return async function (app: FastifyInstance) {
    const clients = new Set<WebSocket>();

    app.get(WS_TICKET_PATH, { websocket: true }, (socket) => {
      clients.add(socket as unknown as WebSocket);

      socket.on('close', () => {
        clients.delete(socket as unknown as WebSocket);
      });
    });

    const broadcast = (type: string, data: unknown) => {
      if (clients.size === 0) return;

      const payload = JSON.stringify({ type, data });
      for (const client of clients) {
        if (client.readyState === 1) {
          client.send(payload);
        }
      }
    };

    // Keep legacy broadcast for backward compat during migration
    container.ticketBroadcast = broadcast;

    // Listen to EventBus for ticket, board, comment, mention, and deliverable events
    const namespaces = ['ticket.*', 'board.*', 'comment.*', 'mention.*', 'deliverable.*'];
    for (const ns of namespaces) {
      container.eventBus.on(ns, (event: DomainEvent) => {
        const wsType = EVENT_TO_WS_TYPE[event.type];
        if (wsType) {
          broadcast(wsType, extractWsData(event));
        }
      });
    }

    app.addHook('onClose', () => {
      for (const client of clients) {
        client.close();
      }
      clients.clear();
    });
  };
}
