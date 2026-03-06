import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { WS_PERSONA_PATH } from '@fleex/shared';
import type { Container } from '../container.js';

export function personaWsPlugin(container: Container) {
  return async function (app: FastifyInstance) {
    const clients = new Set<WebSocket>();

    app.get(WS_PERSONA_PATH, { websocket: true }, (socket) => {
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

    container.personaBroadcast = broadcast;
    container.domainEventListener.setPersonaBroadcast(broadcast);

    app.addHook('onClose', () => {
      for (const client of clients) {
        client.close();
      }
      clients.clear();
    });
  };
}
