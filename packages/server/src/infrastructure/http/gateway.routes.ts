import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Container } from '../container.js';
import type { GatewayRegisterRequest, GatewayHeartbeatRequest } from '@asm/shared';

const STALE_THRESHOLD_MS = 90_000; // 90 seconds

/**
 * Optional registration token. When set, gateways must present this token
 * to register. This prevents rogue gateways from joining the cluster.
 * Set via GATEWAY_REGISTRATION_TOKEN env var.
 */
const REGISTRATION_TOKEN = process.env['GATEWAY_REGISTRATION_TOKEN'] ?? null;

export function gatewayRoutes(container: Container) {
  return async function (app: FastifyInstance) {
    const { gatewayStore, logger } = container;

    if (!gatewayStore) {
      // No Postgres → single-gateway mode, no registry needed
      return;
    }

    if (!REGISTRATION_TOKEN) {
      logger.warn(
        'GATEWAY_REGISTRATION_TOKEN is not set — any client can register as a gateway. ' +
        'Set this environment variable in production to prevent rogue gateway registration.',
      );
    }

    // ── Internal gateway endpoints (called by gateways) ──

    app.post<{ Body: GatewayRegisterRequest }>(
      '/internal/gateways/register',
      async (request, reply) => {
        const { id, name, hostname, secret } = request.body;
        if (!id || !secret) {
          return reply.code(400).send({ error: 'id and secret are required' });
        }

        // Validate registration token if configured
        if (REGISTRATION_TOKEN) {
          const regToken = request.headers['x-gateway-registration-token'] as string | undefined;
          if (regToken !== REGISTRATION_TOKEN) {
            logger.warn('Gateway registration rejected: invalid registration token', { id, name });
            return reply.code(403).send({ error: 'Invalid registration token' });
          }
        }

        const secretHash = createHash('sha256').update(secret).digest('hex');
        const gw = await gatewayStore.register(id, name, hostname ?? null, secretHash);
        logger.info('Gateway registered', { id, name, hostname });
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

        // Validate gateway secret
        const secretHash = createHash('sha256').update(secret).digest('hex');
        const valid = await gatewayStore.verifySecret(id, secretHash);
        if (!valid) {
          logger.warn('Heartbeat rejected: invalid gateway credentials', { id });
          return reply.code(403).send({ error: 'Invalid gateway credentials' });
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
