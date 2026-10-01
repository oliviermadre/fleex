import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ActionsAiCommandRequest, ActionsAiDraftRequest, ActionsAiIconsRequest } from '@fleex/shared';
import { ActionsAiError, type IconSearchPort, type SuggestActionUseCase } from '../../application/use-cases/suggest-action.js';
import { sanitizeSvg } from '../../domain/services/svg-sanitizer.js';

export interface ActionsAiRouteDeps {
  suggestAction: SuggestActionUseCase;
  /** Plain icon search, no model involved — the picker's Library tab works without AI. */
  iconSearch: IconSearchPort;
  isAvailable: () => Promise<boolean>;
  logger: { error: (msg: string, meta?: Record<string, unknown>) => void };
}

function fail(reply: FastifyReply, error: unknown, logger: ActionsAiRouteDeps['logger']) {
  if (error instanceof ActionsAiError) return reply.code(422).send({ error: error.message });
  logger.error('Actions AI request failed', { error: error instanceof Error ? error.message : String(error) });
  return reply.code(502).send({ error: error instanceof Error ? error.message : 'AI request failed' });
}

/**
 * Settings › Actions assistants. Each answers with fields to fill in — none of
 * them runs the commands it proposes.
 */
export function actionsAiRoutes(deps: ActionsAiRouteDeps) {
  return async function (app: FastifyInstance) {
    app.get('/api/actions-ai/status', async () => ({ available: await deps.isAvailable() }));

    app.get<{ Querystring: { q?: string } }>('/api/actions-ai/icons/search', async (request, reply) => {
      const q = request.query.q?.trim();
      if (!q) return { keywords: [], suggestions: [] };
      try {
        return { keywords: [q], suggestions: await deps.iconSearch.search([q], { brandFirst: false, limit: 30 }) };
      } catch {
        return reply.code(502).send({ error: 'Icon library unreachable' });
      }
    });

    /** Manual SVG import goes through the same allow-list as AI and Iconify icons. */
    app.post<{ Body: { svg?: string } }>('/api/actions-ai/icons/sanitize', async (request, reply) => {
      const svg = typeof request.body?.svg === 'string' ? sanitizeSvg(request.body.svg) : null;
      if (!svg) return reply.code(422).send({ error: 'Not a usable SVG (no geometry, or larger than 8 KB).' });
      return { svg };
    });

    const requireAi = async (reply: FastifyReply): Promise<boolean> => {
      if (await deps.isAvailable()) return true;
      await reply.code(503).send({ error: 'AI unavailable: connect Claude on this instance.' });
      return false;
    };

    app.post<{ Body: ActionsAiCommandRequest }>('/api/actions-ai/command', async (request, reply) => {
      if (!(await requireAi(reply))) return reply;
      const body = request.body;
      if (!body?.intent?.trim()) return reply.code(400).send({ error: 'intent is required' });
      try {
        return await deps.suggestAction.command({
          intent: body.intent,
          kind: body.kind === 'probe' || body.kind === 'rule' ? body.kind : 'action',
          scope: body.scope === 'ticket' ? 'ticket' : 'pinned',
          context: body.context,
          exclude: Array.isArray(body.exclude) ? body.exclude.filter((x) => typeof x === 'string') : undefined,
        });
      } catch (error) {
        return fail(reply, error, deps.logger);
      }
    });

    app.post<{ Body: ActionsAiIconsRequest }>('/api/actions-ai/icons', async (request, reply) => {
      if (!(await requireAi(reply))) return reply;
      const body = request.body;
      if (!body?.label?.trim() && !body?.command?.trim()) return reply.code(400).send({ error: 'label is required' });
      try {
        return await deps.suggestAction.iconSuggestions(body);
      } catch (error) {
        return fail(reply, error, deps.logger);
      }
    });

    /** NDJSON: one `{stage}` per step as it starts, then the result (or `{error}`). */
    app.post<{ Body: ActionsAiDraftRequest }>('/api/actions-ai/draft', async (request, reply) => {
      if (!(await requireAi(reply))) return reply;
      const prompt = request.body?.prompt?.trim();
      if (!prompt) return reply.code(400).send({ error: 'prompt is required' });

      reply.raw.writeHead(200, {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
      });
      const write = (payload: unknown) => reply.raw.write(`${JSON.stringify(payload)}\n`);
      try {
        const result = await deps.suggestAction.draft({
          prompt,
          scope: request.body.scope === 'ticket' ? 'ticket' : 'pinned',
          onStage: (stage) => write({ stage }),
        });
        write(result);
      } catch (error) {
        if (!(error instanceof ActionsAiError)) {
          deps.logger.error('Actions AI draft failed', { error: error instanceof Error ? error.message : String(error) });
        }
        write({ error: error instanceof Error ? error.message : String(error) });
      } finally {
        reply.raw.end();
      }
      return reply;
    });
  };
}
