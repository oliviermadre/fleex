import type { FastifyInstance } from 'fastify';
import type { Container } from '../container.js';

export function claudeUsageRoutes(container: Container) {
  return async function (app: FastifyInstance) {
    app.get('/api/claude-usage', async (_request, reply) => {
      const usage = await container.getClaudeUsage.execute();
      if (!usage) {
        return reply.code(503).send({ error: 'Usage data not yet available' });
      }
      return usage;
    });
  };
}
