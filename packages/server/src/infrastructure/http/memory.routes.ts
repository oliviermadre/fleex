import type { FastifyInstance } from 'fastify';
import type { Container } from '../container.js';
import { resolveEmbeddingModel } from '@fleex/shared';
import { isMemoryFeatureEnabled } from '../../application/ports/config.port.js';
import {
  mineAutomationCandidates,
  MIN_OCCURRENCES,
  WINDOW_DAYS,
} from '../../application/memory/automation-mining.js';

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
        // A backfill that ran while the model was still downloading leaves the
        // whole corpus deferred. Draining here rather than waiting for the next
        // sweep tick is what makes the reindex button finish the job.
        .then(() => container.memorySweeper?.sweep())
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
          // Both consumers of this route — the command palette and the CLI — show a
          // list of references, where two passages of one document read as the same
          // result twice.
          oneChunkPerSource: true,
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

    /**
     * The same answer, with its progress.
     *
     * Newline-delimited JSON: one object per stage as it starts, then the result.
     * A separate route rather than content negotiation on the one above, because
     * the CLI and the MCP tools consume that one as a single JSON body and a
     * streamed reply would break both.
     *
     * Written straight to the raw socket. Fastify would otherwise buffer the whole
     * reply, which is the one thing that must not happen here — the progress is
     * worthless if it arrives with the answer.
     */
    app.post<{ Body: { question?: string; limit?: number; repo?: string | null } }>(
      '/api/memory/ask/stream',
      async (request, reply) => {
        const askMemory = container.askMemory;
        const question = request.body?.question?.trim();
        if (!question) return reply.code(400).send({ error: 'Missing `question`.' });
        if (!askMemory) {
          return reply.code(503).send({ error: 'Memory questions are unavailable on this instance.' });
        }

        reply.raw.writeHead(200, {
          'Content-Type': 'application/x-ndjson',
          'Cache-Control': 'no-cache',
          // Proxies that buffer would defeat the whole point of the route.
          'X-Accel-Buffering': 'no',
        });
        const write = (payload: unknown): void => {
          reply.raw.write(`${JSON.stringify(payload)}\n`);
        };

        try {
          const result = await askMemory.execute({
            question,
            limit: request.body.limit,
            repo: request.body.repo ?? null,
            onStage: write,
            onDelta: (delta) => write({ delta }),
          });
          write(result);
        } catch (error) {
          // The status line is long gone, so a failure has to travel in the body.
          container.logger.error('Streamed memory question failed', {
            error: error instanceof Error ? error.message : String(error),
          });
          write({ error: error instanceof Error ? error.message : String(error) });
        } finally {
          reply.raw.end();
        }
        return reply;
      },
    );

    app.get<{ Querystring: { title?: string; limit?: string } }>(
      '/api/memory/similar-tickets',
      async (request) => {
        const retrieve = container.retrieveContext;
        const title = request.query.title?.trim();
        // Answers with an empty list rather than an error when the feature is off:
        // this is called speculatively while someone types, and a 4xx per
        // keystroke would be noise in the console for a feature they disabled.
        if (!title || !retrieve.isFeatureEnabled('duplicateDetection')) {
          return { candidates: [] };
        }

        const limit = clampLimit(request.query.limit, 3, 10);
        // Ticket-shaped sources only. A deliverable or a note that merely mentions
        // the same subject is not a duplicate, and offering it as one would train
        // the reader to ignore the warning.
        const snippets = await retrieve.search({
          query: title,
          limit,
          kinds: ['ticket', 'ticket_summary'],
        });

        // One row per ticket: a ticket and its summary are both retrievable, and
        // warning about the same ticket twice trains the reader to ignore the
        // warning.
        const seen = new Set<string>();
        const candidates: Array<{ ticketId: string; title: string; score: number; excerpt: string }> = [];
        for (const snippet of snippets) {
          const ticketId = snippet.ticketId;
          if (!ticketId || seen.has(ticketId)) continue;
          seen.add(ticketId);
          candidates.push({
            ticketId,
            title: snippet.title,
            score: snippet.score,
            excerpt: snippet.content.slice(0, 200),
          });
        }
        return { candidates };
      },
    );

    // ── Persona coach ──

    app.get<{ Params: { personaId: string } }>(
      '/api/memory/personas/:personaId/coach',
      async (request, reply) => {
        const coach = container.coachPersona;
        if (!coach) return reply.code(503).send({ error: 'Memory is unavailable on this instance.' });
        return coach.propose(request.params.personaId);
      },
    );

    app.post<{ Params: { personaId: string }; Body: { memoryMd?: string } }>(
      '/api/memory/personas/:personaId/coach/apply',
      async (request, reply) => {
        const coach = container.coachPersona;
        if (!coach) return reply.code(503).send({ error: 'Memory is unavailable on this instance.' });

        const memoryMd = request.body?.memoryMd;
        // The reviewed text is required, not regenerated: applying a fresh
        // proposal would write something the user never read.
        if (typeof memoryMd !== 'string') {
          return reply.code(400).send({ error: 'Missing reviewed `memoryMd`.' });
        }
        const applied = await coach.apply(request.params.personaId, memoryMd);
        if (!applied) return reply.code(404).send({ error: 'Agent not found.' });
        return { ok: true };
      },
    );

    // ── Cross-document synthesis ──

    app.post<{ Body: { subject?: string; limit?: number; repo?: string | null; saveToTicketId?: string | null } }>(
      '/api/memory/synthesise',
      async (request, reply) => {
        const synthesise = container.synthesiseMemory;
        if (!synthesise) return reply.code(503).send({ error: 'Memory is unavailable on this instance.' });

        const subject = request.body?.subject?.trim();
        if (!subject) return reply.code(400).send({ error: 'Missing `subject`.' });

        const result = await synthesise.execute({
          subject,
          limit: request.body.limit,
          repo: request.body.repo ?? null,
          saveToTicketId: request.body.saveToTicketId ?? null,
        });
        if (result.reason === 'unavailable') {
          return reply.code(409).send({ error: 'Cross-document synthesis is switched off in Settings › Memory.' });
        }
        return result;
      },
    );

    // ── Curation ──

    app.post<{
      Body: {
        executionId?: string;
        title?: string;
        content?: string;
        comment?: string | null;
        ticketId?: string | null;
        repo?: string | null;
        agentName?: string | null;
      };
    }>('/api/memory/curate', async (request, reply) => {
      const executionId = request.body?.executionId?.trim();
      if (!executionId) return reply.code(400).send({ error: 'Missing `executionId`.' });

      const result = await container.curateMemory.curate({
        executionId,
        title: request.body.title,
        content: request.body.content,
        comment: request.body.comment ?? null,
        ticketId: request.body.ticketId ?? null,
        repo: request.body.repo ?? null,
        agentName: request.body.agentName ?? null,
      });

      if (result.reason === 'unavailable') {
        return reply.code(409).send({ error: 'Curation is switched off in Settings › Memory.' });
      }
      if (result.reason === 'empty') {
        return reply.code(400).send({ error: 'Nothing to save — the execution produced no text.' });
      }
      return result;
    });

    app.delete<{ Params: { noteId: string } }>('/api/memory/curated/:noteId', async (request) => {
      await container.curateMemory.forget(decodeURIComponent(request.params.noteId));
      return { ok: true };
    });

    // ── Assistant conversation memory ──

    app.post<{
      Body: {
        conversationId?: string;
        title?: string;
        repo?: string | null;
        turns?: Array<{ role: 'user' | 'assistant'; content: string }>;
      };
    }>('/api/memory/remember-conversation', async (request, reply) => {
      const conversationId = request.body?.conversationId?.trim();
      const turns = request.body?.turns;
      if (!conversationId || !Array.isArray(turns)) {
        return reply.code(400).send({ error: 'Missing `conversationId` or `turns`.' });
      }

      const result = await container.rememberConversation.execute({
        conversationId,
        title: request.body.title,
        turns,
        repo: request.body.repo ?? null,
      });
      // "Nothing worth remembering" is the common case, not an error: most
      // conversations establish nothing durable.
      return result;
    });

    // ── Automation mining ──

    app.get<{ Querystring: { minOccurrences?: string; windowDays?: string } }>(
      '/api/memory/automation-candidates',
      async (request) => {
        // Purely arithmetic over the execution log, so it needs no index — but it
        // is still gated, since an unwanted suggestion is still noise.
        if (!isMemoryFeatureEnabled(container.config.get(), 'automationMining')) {
          return { candidates: [] };
        }
        const executions = await container.agentEventStore.getAllExecutions();
        const candidates = mineAutomationCandidates(executions, {
          minOccurrences: clampLimit(request.query.minOccurrences, MIN_OCCURRENCES, 50),
          windowDays: clampLimit(request.query.windowDays, WINDOW_DAYS, 365),
        });
        return { candidates };
      },
    );

    app.get<{ Querystring: { cases?: string; k?: string } }>(
      '/api/memory/bench',
      async (request) => {
        // Not flag-gated: measuring retrieval is how someone decides whether to
        // trust it, so it must be available precisely when they are unsure.
        return container.benchMemory.execute({
          cases: clampLimit(request.query.cases, 30, 200),
          k: clampLimit(request.query.k, 5, 50),
        });
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
      // The active model id is what makes "stale" meaningful: the store cannot
      // know which encoder is configured.
      const stats = await store.getStats(provider?.id ?? null);

      const settings = container.config.get();
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
              // What is missing when it is not installed — a package for the
              // in-process runtime, a daemon for Ollama.
              packageName: provider.runtimeLabel,
              runtime: settings.memoryEmbeddingProvider ?? 'transformers',
              model: resolveEmbeddingModel(settings.memoryEmbeddingModel).id,
            }
          : null,
        index: stats,
        injectionCharBudget: settings.memoryInjectionCharBudget ?? null,
        reindexing: running !== null,
      };
    });
  };
}
