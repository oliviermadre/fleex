import type { ServerCapabilities } from '@fleex/shared';

import type { FastifyInstance } from 'fastify';

/**
 * Short-circuits every route in the enclosing plugin with 503 FEATURE_UNAVAILABLE
 * when the storage driver has no workflow stores.
 *
 * The routes stay registered on purpose: an unregistered route answers 404, which a
 * client (web, CLI, MCP) cannot distinguish from a typo. 503 with a structured code
 * says *why*.
 */
export function registerWorkflowGuard(
  app: FastifyInstance,
  capabilities: ServerCapabilities,
): void {
  app.addHook('preHandler', async (_request, reply) => {
    if (capabilities.features.workflows) return;
    return reply.code(503).send({
      error: 'FEATURE_UNAVAILABLE',
      feature: 'workflows',
      driver: capabilities.storageDriver,
      message:
        `Workflows are not available on the "${capabilities.storageDriver}" storage driver. ` +
        'Switch to sqlite, pgsql or supabase to enable them.',
    });
  });
}
