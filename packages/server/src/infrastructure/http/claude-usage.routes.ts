import type { FastifyInstance } from 'fastify';
import type { Container } from '../container.js';

export function claudeUsageRoutes(container: Container) {
  return async function (app: FastifyInstance) {
    app.get<{ Querystring: { force?: string } }>('/api/claude-usage', async (request, reply) => {
      const force = request.query.force === 'true';
      const usage = await container.getClaudeUsage.execute(force);
      if (!usage) {
        return reply.code(503).send({ error: 'Usage data not yet available' });
      }
      return usage;
    });
  };
}
