import type { RunActionRequest } from '@fleex/shared';

import type { Container } from '../container.js';
import type { FastifyInstance } from 'fastify';

/**
 * Replaces `POST /api/exec`.
 *
 * The body carries no executable string of any kind: `:id` selects a definition
 * from `AppConfig.actions`, and `params` are validated against that definition's
 * declared schema. Everything the command actually runs comes from server-side
 * config.
 */
export function actionRoutes(container: Container) {
  return async function (app: FastifyInstance) {
    app.post<{ Params: { id: string }; Body: RunActionRequest | undefined }>(
      '/api/actions/:id/run',
      async (request, reply) => {
        const body = request.body ?? {};
        const result = await container.runAction.execute({
          actionId: request.params.id,
          ...(body.ticketId ? { ticketId: body.ticketId } : {}),
          ...(body.params ? { params: body.params } : {}),
        });
        return reply.send(result);
      },
    );
  };
}
