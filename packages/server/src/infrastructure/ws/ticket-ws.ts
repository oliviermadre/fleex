import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { WS_TICKET_PATH } from '@asm/shared';
import type { Container } from '../container.js';

interface AuthenticatedClient {
  socket: WebSocket;
  userId: string;
}

export function ticketWsPlugin(container: Container) {
  return async function (app: FastifyInstance) {
    const clients = new Set<AuthenticatedClient>();

    app.get(WS_TICKET_PATH, { websocket: true }, (socket, req) => {
      const userId = req.userId;
      if (!userId) {
        socket.close();
        return;
      }
      const client: AuthenticatedClient = { socket: socket as unknown as WebSocket, userId };
      clients.add(client);

      socket.on('close', () => {
        clients.delete(client);
      });
    });

    const broadcast = (type: string, data: unknown) => {
      if (clients.size === 0) return;

      const payload = JSON.stringify({ type, data });
      for (const client of clients) {
        if (client.socket.readyState === 1) {
          client.socket.send(payload);
        }
      }
    };

    // Wire up broadcast to container
    container.ticketBroadcast = broadcast;

    app.addHook('onClose', () => {
      for (const client of clients) {
        client.socket.close();
      }
      clients.clear();
    });
  };
}
