import { resolveCapabilities } from '../../application/capabilities.js';

import type { Container } from '../container.js';
import type { FastifyInstance } from 'fastify';

export function capabilitiesRoutes(container: Container) {
  return async function (app: FastifyInstance) {
    app.get('/api/capabilities', async () => resolveCapabilities(container));
  };
}
