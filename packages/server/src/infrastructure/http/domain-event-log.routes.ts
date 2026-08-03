import type { Container } from '../container.js';
import type { FastifyInstance } from 'fastify';

export function domainEventLogRoutes(container: Container) {
  return async function (app: FastifyInstance) {
    // GET /api/events — paginated list
    app.get<{
      Querystring: {
        limit?: string;
        before?: string;
        eventType?: string;
        instanceId?: string;
        since?: string;
      };
    }>('/api/events', async (request) => {
      const limit = Math.min(parseInt(request.query.limit ?? '50', 10) || 50, 200);
      const before = request.query.before || undefined;
      const eventType = request.query.eventType || undefined;
      const instanceId = request.query.instanceId || undefined;
      const since = request.query.since ? new Date(request.query.since) : undefined;

      const entries = await container.domainEventLogStore.list({
        limit,
        before,
        eventType,
        instanceId,
        since,
      });

      return entries.map((e) => e.toDTO());
    });

    // GET /api/events/stats — total count
    app.get('/api/events/stats', async () => {
      const totalEvents = await container.domainEventLogStore.count();
      return { totalEvents };
    });

    // DELETE /api/events — retention cleanup
    app.delete<{
      Querystring: { olderThanDays?: string };
    }>('/api/events', async (request) => {
      const days = parseInt(request.query.olderThanDays ?? '30', 10) || 30;
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const deleted = await container.domainEventLogStore.deleteOlderThan(cutoff);
      return { deleted };
    });
  };
}
