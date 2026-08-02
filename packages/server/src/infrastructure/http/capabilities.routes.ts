import type { FastifyInstance } from 'fastify';
import type { Container } from '../container.js';
import { resolveCapabilities } from '../../application/capabilities.js';

export function capabilitiesRoutes(container: Container) {
  return async function (app: FastifyInstance) {
    app.get('/api/capabilities', async () => resolveCapabilities(container));
  };
}
