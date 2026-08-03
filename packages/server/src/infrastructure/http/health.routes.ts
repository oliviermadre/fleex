import type { Container } from '../container.js';
import type { FastifyInstance } from 'fastify';

const startTime = Date.now();

export function healthRoutes(container: Container) {
  return async function (app: FastifyInstance) {
    app.get('/health', async () => {
      const tmuxAvailable = await container.tmux.isAvailable();
      return {
        status: 'ok',
        tmux: tmuxAvailable,
        uptime: Math.floor((Date.now() - startTime) / 1000),
      };
    });
  };
}
