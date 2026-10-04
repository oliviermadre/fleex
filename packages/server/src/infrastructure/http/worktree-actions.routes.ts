import type { FastifyInstance, FastifyReply } from 'fastify';
import type { WorktreeActionsListResponse, WorktreeRunRequest } from '@fleex/shared';
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

    // Settings › Actions et Hooks: both layers, the merged view, overlay files and file hooks.
    app.get<{ Querystring: { repo?: string; path?: string } }>('/api/worktree-actions/settings', async (request, reply) => {
      const repo = request.query.repo ?? '';
      if (!REPO_REF.test(repo)) return reply.code(400).send({ error: 'repo must be org/name' });
      const path = request.query.path || null;
      if (path !== null && !managed(path, reply)) return reply;
      try {
        return await worktreeActions.settings(repo, path);
      } catch (err) {
        return fail(err, reply);
      }
    });

    // One key in one layer (value null/absent = remove). Shared = the worktree's .fleex/worktree.json.
    app.post<{ Body: { repo?: string; path?: string | null; layer?: string; key?: string; value?: unknown } }>('/api/worktree-actions/config', async (request, reply) => {
      const body = request.body ?? {};
      const repo = body.repo ?? '';
      if (!REPO_REF.test(repo)) return reply.code(400).send({ error: 'repo must be org/name' });
      if (body.layer !== 'personal' && body.layer !== 'shared') return reply.code(400).send({ error: 'layer must be personal or shared' });
      if (typeof body.key !== 'string') return reply.code(400).send({ error: 'key is required' });
      const path = body.path || null;
      if (path !== null && !managed(path, reply)) return reply;
      try {
        return await worktreeActions.setKey(repo, path, body.layer, body.key, body.value ?? undefined);
      } catch (err) {
        return fail(err, reply);
      }
    });

    // Partager (personal → .fleex/worktree.json) / Garder pour moi (→ personal, optionally out of the file).
    app.post<{ Body: { path?: string; keys?: unknown } }>('/api/worktree-actions/share', async (request, reply) => {
      const body = request.body ?? {};
      if (!managed(body.path, reply)) return reply;
      const keys = Array.isArray(body.keys) ? body.keys.filter((k): k is string => typeof k === 'string') : [];
      if (keys.length === 0) return reply.code(400).send({ error: 'keys is required' });
      try {
        return await worktreeActions.share(body.path, keys);
      } catch (err) {
        return fail(err, reply);
      }
    });

    app.post<{ Body: { path?: string; keys?: unknown; removeFromFile?: boolean } }>('/api/worktree-actions/unshare', async (request, reply) => {
      const body = request.body ?? {};
      if (!managed(body.path, reply)) return reply;
      const keys = Array.isArray(body.keys) ? body.keys.filter((k): k is string => typeof k === 'string') : [];
      if (keys.length === 0) return reply.code(400).send({ error: 'keys is required' });
      try {
        return await worktreeActions.unshare(body.path, keys, body.removeFromFile === true);
      } catch (err) {
        return fail(err, reply);
      }
    });

    // Run a hook now: "Tester" (a draft command) or "Relancer le Setup".
    app.post<{ Body: { path?: string; hook?: string; command?: unknown } }>('/api/worktree-actions/hooks/run', async (request, reply) => {
      const body = request.body ?? {};
      if (!managed(body.path, reply)) return reply;
      if (body.hook !== 'setup' && body.hook !== 'teardown') return reply.code(400).send({ error: 'hook must be setup or teardown' });
      const command = typeof body.command === 'string' ? body.command : undefined;
      try {
        const result = await worktreeActions.runHook(body.path, body.hook, command);
        return reply.code(result.runId && !result.alreadyRunning ? 202 : 200).send(result);
      } catch (err) {
        return fail(err, reply);
      }
    });

    app.post<{ Body: { repo?: string } }>('/api/worktree-actions/hooks/open', async (request, reply) => {
      const repo = request.body?.repo ?? '';
      if (!REPO_REF.test(repo)) return reply.code(400).send({ error: 'repo must be org/name' });
      return worktreeActions.openHooksDir(repo);
    });
  };
}
