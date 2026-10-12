import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  DEFAULT_CLEANUP_OLDER_THAN,
  WORKTREE_CLEANUP_STATUSES,
  parseCleanupStatuses,
  type WorktreeCleanupRequest,
} from '@fleex/shared';
import {
  CleanupInProgressError,
  CleanupRequestError,
  type WorktreeCleanupOptions,
  type WorktreeCleanupUseCase,
} from '../../application/use-cases/worktree-cleanup.js';

interface Deps {
  worktreeCleanup: WorktreeCleanupUseCase;
}

/** Turn query/body params into use-case options, or a 400 message. */
function toOptions(req: Omit<WorktreeCleanupRequest, 'size'> & { size?: boolean | string }): WorktreeCleanupOptions | string {
  const parsed = parseCleanupStatuses(req.status ?? WORKTREE_CLEANUP_STATUSES.join(','));
  if ('error' in parsed) return parsed.error;
  return {
    olderThan: req.olderThan || DEFAULT_CLEANUP_OLDER_THAN,
    statuses: parsed.statuses,
    ticket: req.ticket || null,
    size: req.size !== false && req.size !== 'false' && req.size !== '0',
  };
}

function sendError(reply: FastifyReply, err: unknown) {
  if (err instanceof CleanupInProgressError) return reply.code(409).send({ error: err.message });
  if (err instanceof CleanupRequestError) return reply.code(400).send({ error: err.message });
  throw err;
}

/**
 * `fleex worktree cleanup`. The plan is read-only (bare clones are fetched).
 * Apply takes the same criteria — never a plan — and recomputes everything
 * server-side, so a stale or hand-edited plan can't delete anything.
 */
export function worktreeCleanupRoutes(deps: Deps) {
  return async function (app: FastifyInstance) {
    app.get<{ Querystring: Omit<WorktreeCleanupRequest, 'size'> & { size?: string } }>('/api/worktree-cleanup/plan', async (request, reply) => {
      const opts = toOptions(request.query);
      if (typeof opts === 'string') return reply.code(400).send({ error: opts });
      try {
        return await deps.worktreeCleanup.plan(opts);
      } catch (err) {
        return sendError(reply, err);
      }
    });

    app.post<{ Body: WorktreeCleanupRequest }>('/api/worktree-cleanup/apply', async (request, reply) => {
      const opts = toOptions(request.body ?? {});
      if (typeof opts === 'string') return reply.code(400).send({ error: opts });
      // The CLI going away (Ctrl-C) stops the run between two worktrees.
      const abort = new AbortController();
      reply.raw.on('close', () => {
        if (!reply.raw.writableFinished) abort.abort();
      });
      try {
        return await deps.worktreeCleanup.apply(opts, abort.signal);
      } catch (err) {
        return sendError(reply, err);
      }
    });
  };
}
