import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { WS_TICKET_PATH } from '@fleex/shared';
import type { Container } from '../container.js';

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

    // Wire up broadcast to container
    container.ticketBroadcast = broadcast;
    container.autoReviewWorkflow.onTicketUpdate = broadcast;

    app.addHook('onClose', () => {
      for (const client of clients) {
        client.close();
      }
      clients.clear();
    });
  };
}
