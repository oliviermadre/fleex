import type { FastifyInstance, FastifyReply } from 'fastify';
import type { WorktreeActionsListResponse, WorktreeConfig, WorktreeRunRequest } from '@fleex/shared';
import { WorktreeActionError, type WorktreeActionsService } from '../../application/services/worktree-actions.service.js';
import type { RepoPathResolver } from '../../domain/services/repo-path-resolver.js';

export interface WorktreeActionsRouteDeps {
  worktreeActions: WorktreeActionsService;
  resolver: Pick<RepoPathResolver, 'isManagedPath'>;
}

const REPO_REF = /^[^/\s]+\/[^/\s]+$/;

/**
 * The worktree buttons (WORKTREES group of the Work top bar) and their CLI
 * twin, `fleex repo actions|run|pin`. Paths are client-supplied: they must
 * resolve inside the managed base directory.
 */
export function worktreeActionsRoutes(deps: WorktreeActionsRouteDeps) {
  return async function (app: FastifyInstance) {
    const { worktreeActions } = deps;

    const managed = (path: unknown, reply: FastifyReply): path is string => {
      if (typeof path === 'string' && path && deps.resolver.isManagedPath(path)) return true;
      void reply.code(400).send({ error: 'path must be a worktree or workspace inside the managed workspace root' });
      return false;
    };

    const fail = (err: unknown, reply: FastifyReply) => {
      if (err instanceof WorktreeActionError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    };

    // Every worktree under `path` (a ticket workspace or a worktree): items, start target, server state.
    app.get<{ Querystring: { path?: string } }>('/api/worktree-actions', async (request, reply) => {
      if (!managed(request.query.path, reply)) return reply;
      const worktrees = await worktreeActions.list(request.query.path);
      return { worktrees } satisfies WorktreeActionsListResponse;
    });

    app.post<{ Body: Partial<WorktreeRunRequest> }>('/api/worktree-actions/run', async (request, reply) => {
      const body = request.body ?? {};
      if (!managed(body.path, reply)) return reply;
      try {
        const result = await worktreeActions.run(body.path, { ...(body.id !== undefined ? { id: String(body.id) } : {}), ...(body.verb !== undefined ? { verb: String(body.verb) } : {}) });
        // "Already running" is an answer, not a refusal (those are 4xx with `error`).
        return reply.code(result.runId && !result.alreadyRunning ? 202 : 200).send(result);
      } catch (err) {
        return fail(err, reply);
      }
    });

    for (const [route, pinned] of [['pin', true], ['unpin', false]] as const) {
      app.post<{ Body: { path?: string; id?: string } }>(`/api/worktree-actions/${route}`, async (request, reply) => {
        const body = request.body ?? {};
        if (!managed(body.path, reply)) return reply;
        if (typeof body.id !== 'string' || !body.id.trim()) return reply.code(400).send({ error: 'id is required' });
        try {
          return await worktreeActions.setPinned(body.path, body.id.trim(), pinned);
        } catch (err) {
          return fail(err, reply);
        }
      });
    }

    // Personal layer of a repo (Settings › repo › Setup hook reads and writes it).
    app.get<{ Querystring: { repo?: string } }>('/api/worktree-actions/personal', async (request, reply) => {
      const repo = request.query.repo ?? '';
      if (!REPO_REF.test(repo)) return reply.code(400).send({ error: 'repo must be org/name' });
      return worktreeActions.getPersonal(repo);
    });

    app.put<{ Body: { repo?: string; hooks?: WorktreeConfig['hooks'] } }>('/api/worktree-actions/personal/hooks', async (request, reply) => {
      const repo = request.body?.repo ?? '';
      if (!REPO_REF.test(repo)) return reply.code(400).send({ error: 'repo must be org/name' });
      const hooks = request.body?.hooks ?? {};
      const patch: NonNullable<WorktreeConfig['hooks']> = {};
      if (typeof hooks.setup === 'string') patch.setup = hooks.setup;
      if (typeof hooks.timeoutSec === 'number' && hooks.timeoutSec > 0) patch.timeoutSec = Math.min(3600, Math.round(hooks.timeoutSec));
      return worktreeActions.updatePersonal(repo, (cfg) => ({ ...cfg, hooks: { ...(cfg.hooks ?? {}), ...patch } }));
    });
  };
}
