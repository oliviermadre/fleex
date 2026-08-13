import type { FastifyInstance } from 'fastify';
import type { Container } from '../container.js';
import { TransformersEmbeddingAdapter } from '../adapters/embeddings/transformers-embedding.adapter.js';

/** Parse a query-string limit, falling back and capping rather than erroring. */
function clampLimit(raw: string | undefined, fallback: number, max: number): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

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

    app.get<{ Querystring: { q?: string; limit?: string; repo?: string } }>(
      '/api/memory/search',
      async (request, reply) => {
        const retrieve = container.retrieveContext;
        const query = request.query.q?.trim();
        if (!query) return reply.code(400).send({ error: 'Missing query parameter `q`.' });
        if (!retrieve.isSemanticEnabled()) {
          return reply.code(409).send({
            error: 'The semantic memory engine is not enabled. Turn it on in Settings › Memory.',
          });
        }

        const limit = clampLimit(request.query.limit, 10, 50);
        const results = await retrieve.search({
          query,
          limit,
          repo: request.query.repo ?? null,
        });
        return { query, results };
      },
    );

    app.post<{ Body: { question?: string; limit?: number; repo?: string | null } }>(
      '/api/memory/ask',
      async (request, reply) => {
        const askMemory = container.askMemory;
        const question = request.body?.question?.trim();
        if (!question) return reply.code(400).send({ error: 'Missing `question`.' });
        if (!askMemory) {
          return reply.code(503).send({ error: 'Memory questions are unavailable on this instance.' });
        }

        const result = await askMemory.execute({
          question,
          limit: request.body.limit,
          repo: request.body.repo ?? null,
        });

        // A question the memory cannot answer is a normal outcome, not an error:
        // the caller still gets the sources so it can say what *is* known.
        if (result.reason === 'unavailable') {
          return reply.code(409).send({
            error: 'The semantic memory engine is not enabled. Turn it on in Settings › Memory.',
          });
        }
        return result;
      },
    );

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
          ? {
              id: provider.id,
              dimensions: provider.dimensions,
              ready: provider.isReady(),
              // Separating "installed" from "ready" is what lets the UI tell the
              // user to install a package versus to wait for a download.
              installed: await provider.isInstalled(),
              packageName: TransformersEmbeddingAdapter.PACKAGE_NAME,
            }
          : null,
        index: stats,
        reindexing: running !== null,
      };
    });
  };
}
