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
  /**
   * The in-flight backfill, if any.
   *
   * A backfill walks the whole corpus and embeds it; two of them at once would
   * double the CPU cost to reach the same index, since the second pass finds
   * every hash already written by the first. Holding the promise lets a repeated
   * request report "already running" instead of starting a rival pass.
   */
  let running: Promise<unknown> | null = null;

  return async function (app: FastifyInstance) {
    app.post('/api/memory/reindex', async (_request, reply) => {
      const backfill = container.backfillMemory;
      if (!backfill) {
        return reply.code(503).send({ error: 'No memory index is available on this storage driver.' });
      }
      if (running) {
        return reply.code(409).send({ error: 'A reindex is already running.' });
      }

      // Answer immediately: a full backfill outlives any sensible request
      // timeout, and progress is readable from /api/memory/status meanwhile.
      running = backfill.execute()
        .catch((error: unknown) => {
          container.logger.error('Memory reindex failed', {
            error: error instanceof Error ? error.message : String(error),
          });
        })
        .finally(() => { running = null; });

      return reply.code(202).send({ started: true });
    });

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
          reindexing: false,
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
        reindexing: running !== null,
      };
    });
  };
}
