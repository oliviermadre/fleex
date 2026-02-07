import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { WS_DASHBOARD_PATH, DASHBOARD_BROADCAST_INTERVAL_MS } from '@asm/shared';
import type { DashboardMessage } from '@asm/shared';
import type { Container } from '../container.js';

export function dashboardWsPlugin(container: Container) {
  return async function (app: FastifyInstance) {
    const clients = new Set<WebSocket>();

    app.get(WS_DASHBOARD_PATH, { websocket: true }, (socket) => {
      clients.add(socket as unknown as WebSocket);

      socket.on('close', () => {
        clients.delete(socket as unknown as WebSocket);
      });
    });

    const interval = setInterval(async () => {
      if (clients.size === 0) return;

      try {
        const groups = await container.getSessionGroups.execute();
        const message: DashboardMessage = {
          type: 'sessions:updated',
          data: groups,
        };
        const payload = JSON.stringify(message);

        for (const client of clients) {
          if (client.readyState === 1) {
            client.send(payload);
          }
        }
      } catch (err) {
        container.logger.error('Dashboard broadcast failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }, DASHBOARD_BROADCAST_INTERVAL_MS);

    app.addHook('onClose', () => {
      clearInterval(interval);
      for (const client of clients) {
        client.close();
      }
      clients.clear();
    });
  };
}
