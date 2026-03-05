import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Container } from '../container.js';
import type { GatewayRegisterRequest, GatewayHeartbeatRequest } from '@fleex/shared';

const STALE_THRESHOLD_MS = 90_000; // 90 seconds

export function gatewayRoutes(container: Container) {
  return async function (app: FastifyInstance) {
    const { gatewayStore, logger } = container;

    if (!gatewayStore) {
      // No database — accept registration/heartbeat with in-memory tracking
      const registeredGateways = new Set<string>();

      app.post<{ Body: GatewayRegisterRequest }>(
        '/internal/gateways/register',
        async (request) => {
          const { id, name, hostname } = request.body;
          registeredGateways.add(id);
          logger.info('Gateway registered (in-memory)', { id, name, hostname });
          return { gateway: { id, name, hostname, status: 'online' } };
        },
      );

      app.post<{ Body: GatewayHeartbeatRequest }>(
        '/internal/gateways/heartbeat',
        async (request) => {
          const { id } = request.body;
          registeredGateways.add(id);
          return { ok: true };
        },
      );

      app.get('/api/gateways', async () => {
        return Array.from(registeredGateways).map((id) => ({
          id,
          name: null,
          hostname: null,
          status: 'online',
          lastSeenAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        }));
      });

      return;
    }

    // ── Internal gateway endpoints (called by gateways) ──

    app.post<{ Body: GatewayRegisterRequest }>(
      '/internal/gateways/register',
      async (request, reply) => {
        const { id, name, hostname, secret } = request.body;
        if (!id || !secret) {
          return reply.code(400).send({ error: 'id and secret are required' });
        }
        const secretHash = createHash('sha256').update(secret).digest('hex');
        const gw = await gatewayStore.register(id, name, hostname ?? null, secretHash);
        return { gateway: gw };
      },
    );

    app.post<{ Body: GatewayHeartbeatRequest }>(
      '/internal/gateways/heartbeat',
      async (request, reply) => {
        const { id, secret } = request.body;
        if (!id || !secret) {
          return reply.code(400).send({ error: 'id and secret are required' });
        }
        const ok = await gatewayStore.heartbeat(id);
        if (!ok) {
          return reply.code(404).send({ error: 'Gateway not found' });
        }
        return { ok: true };
      },
    );

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
