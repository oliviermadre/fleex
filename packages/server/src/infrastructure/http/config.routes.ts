import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../../application/ports/config.port.js';
import type { Container } from '../container.js';

export function configRoutes(container: Container) {
  return async function (app: FastifyInstance) {
    app.get('/api/config', async () => {
      return container.config.get();
    });

    app.put<{ Body: Partial<AppConfig> }>('/api/config', async (request) => {
      await container.config.update(request.body);
      return container.config.get();
    });
  };
}
