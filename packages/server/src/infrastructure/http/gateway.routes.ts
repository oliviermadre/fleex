import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Container } from '../container.js';

const STALE_THRESHOLD_MS = 90_000; // 90 seconds

export function gatewayRoutes(container: Container) {
  return async function (app: FastifyInstance) {
    const { createGatewayStoreForUser, logger } = container;

    if (!createGatewayStoreForUser) {
      // No database — single-gateway mode, no registry needed
      return;
    }

    // ── Gateway registration (called from the gateway CLI setup) ──
    //
    // The authenticated user registers a gateway by providing the
    // gateway's id + plaintext secret. The server stores SHA256(secret).
    // When the gateway later connects via tunnel, it proves it knows
    // the secret, and the server maps it back to this user.

    app.post<{
      Body: { id: string; name?: string; hostname?: string; secret: string };
    }>('/api/gateways/register', async (request, reply) => {
      const userId = request.userId;
      if (!userId) return reply.code(401).send({ error: 'Authentication required' });

      const { id, name, hostname, secret } = request.body;
      if (!id || !secret) {
        return reply.code(400).send({ error: 'id and secret are required' });
      }

      const secretHash = createHash('sha256').update(secret).digest('hex');
      const store = createGatewayStoreForUser(userId);
      try {
        const gw = await store.register(id, name || id, hostname || null, secretHash);
        logger.info('Gateway registered via API', { userId, gatewayId: id, name });

        return reply.code(201).send({
          id: gw.id,
          name: gw.name,
          hostname: gw.hostname,
          status: gw.status,
          createdAt: gw.createdAt.toISOString(),
        });
      } catch (err) {
        if (err instanceof Error && err.message.includes('already registered to another user')) {
          return reply.code(409).send({ error: 'Gateway ID is already registered to another user' });
        }
        throw err;
      }
    });

    // ── List gateways for the authenticated user ──

    app.get('/api/gateways', async (request, reply) => {
      const userId = request.userId;
      if (!userId) return reply.code(401).send({ error: 'Authentication required' });

      const store = createGatewayStoreForUser(userId);
      const gateways = await store.getAll();
      return gateways.map((gw) => ({
        id: gw.id,
        name: gw.name,
        hostname: gw.hostname,
        status: gw.status,
        lastSeenAt: gw.lastSeenAt?.toISOString() ?? null,
        createdAt: gw.createdAt.toISOString(),
      }));
    });

    // ── Delete a gateway belonging to the authenticated user ──

    app.delete<{ Params: { id: string } }>(
      '/api/gateways/:id',
      async (request, reply) => {
        const userId = request.userId;
        if (!userId) return reply.code(401).send({ error: 'Authentication required' });

        const store = createGatewayStoreForUser(userId);
        await store.remove(request.params.id);
        return reply.code(204).send();
      },
    );

    // Stale gateway check — runs periodically (uses default store for all gateways)
    if (container.gatewayStore) {
      const checkInterval = setInterval(async () => {
        try {
          const staleIds = await container.gatewayStore!.markStaleOffline(STALE_THRESHOLD_MS);
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
    }
  };
}
