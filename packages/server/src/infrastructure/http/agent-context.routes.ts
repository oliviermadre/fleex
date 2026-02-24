import type { FastifyInstance } from 'fastify';
import type { Container } from '../container.js';

export function agentContextRoutes(container: Container) {
  return async function (app: FastifyInstance) {

    // Get full ticket context (single call for agent context window)
    app.get<{
      Params: { id: string };
      Querystring: { comments_limit?: string; activity_limit?: string };
    }>('/tickets/:id/context', async (request) => {
      const agentName = request.agent?.name ?? '';
      const commentsLimit = request.query.comments_limit
        ? parseInt(request.query.comments_limit, 10)
        : undefined;
      const activityLimit = request.query.activity_limit
        ? parseInt(request.query.activity_limit, 10)
        : undefined;

      return container.getTicketContext.execute({
        ticketId: request.params.id,
        agentName,
        commentsLimit,
        activityLimit,
      });
    });
  };
}
