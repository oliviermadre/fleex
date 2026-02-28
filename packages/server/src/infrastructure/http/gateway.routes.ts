import type { FastifyInstance } from 'fastify';
import type { Container } from '../container.js';

const STALE_THRESHOLD_MS = 90_000; // 90 seconds

export function gatewayRoutes(container: Container) {
  return async function (app: FastifyInstance) {
    const { gatewayStore, logger } = container;

    if (!gatewayStore) {
      // No Postgres → single-gateway mode, no registry needed
      return;
    }

    // ── Public API endpoints (called by frontend) ──

    app.get('/api/gateways', async () => {
      const gateways = await gatewayStore.getAll();
      return gateways.map((gw) => ({
        id: gw.id,
        name: gw.name,
        hostname: gw.hostname,
        status: gw.status,
        lastSeenAt: gw.lastSeenAt?.toISOString() ?? null,
        createdAt: gw.createdAt.toISOString(),
      }));
    });

    app.delete<{ Params: { id: string } }>(
      '/api/gateways/:id',
      async (request, reply) => {
        await gatewayStore.remove(request.params.id);
        return reply.code(204).send();
      },
    );

    // Stale gateway check — runs periodically
    const checkInterval = setInterval(async () => {
      try {
        const staleIds = await gatewayStore.markStaleOffline(STALE_THRESHOLD_MS);
        if (staleIds.length > 0) {
          logger.info('Marked gateways offline (stale)', { ids: staleIds });
        }
      } catch (err) {
        logger.error('Stale gateway check failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }, 30_000);

    app.addHook('onClose', () => clearInterval(checkInterval));
  };
}
