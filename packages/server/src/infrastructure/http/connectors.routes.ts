import type { FastifyInstance } from 'fastify';
import type { Container } from '../container.js';

/**
 * Settings → Connectors. The Slack token is WRITE-ONLY over HTTP: it comes in
 * through PUT and is never part of any response — a status says who is
 * connected, with a 4-character hint to tell tokens apart.
 */
export function connectorsRoutes(container: Container) {
  return async function (app: FastifyInstance) {
    app.get('/api/connectors/slack', async () => container.manageSlackConnector.status());

    app.put<{ Body: { token?: unknown } }>('/api/connectors/slack', async (request) =>
      container.manageSlackConnector.connect(request.body?.token),
    );

    app.delete('/api/connectors/slack', async () => container.manageSlackConnector.disconnect());
  };
}
