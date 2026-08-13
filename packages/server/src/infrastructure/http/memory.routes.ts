import type { FastifyInstance } from 'fastify';
import type { Container } from '../container.js';

/**
 * Status of the memory kernel, for the Settings panel.
 *
 * The panel needs to answer three questions before a user can sensibly opt into
 * the beta: is an index available on this storage driver at all, has the model
 * been fetched, and how much has been indexed so far. Reporting them together
 * keeps the UI from having to infer availability from a failed call.
 */
export function memoryRoutes(container: Container) {
  return async function (app: FastifyInstance) {
    app.get('/api/memory/status', async () => {
      const engine = container.config.get().memoryEngine ?? 'legacy';
      const store = container.memoryStore;

      if (!store) {
        return {
          engine,
          available: false,
          reason: 'This storage driver has no memory index yet.',
          provider: null,
          index: null,
        };
      }

      const provider = container.embeddingProvider;
      const stats = await store.getStats();

      return {
        engine,
        available: true,
        provider: provider
          ? { id: provider.id, dimensions: provider.dimensions, ready: provider.isReady() }
          : null,
        index: stats,
      };
    });
  };
}
