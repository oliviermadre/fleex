import type { FastifyInstance } from 'fastify';
import { validateActionDefs } from '@fleex/shared';
import { ActionInvalidParamsError } from '../../domain/errors.js';
import type { AppConfig } from '../../application/ports/config.port.js';
import type { Container } from '../container.js';

export function configRoutes(container: Container) {
  return async function (app: FastifyInstance) {
    app.get('/api/config', async () => {
      // Surface the workspace this instance targets (from the CLI-injected
      // FLEEX_WORKSPACE env) so the web can pin assistant sessions to the
      // workspace the user is viewing. Read-only, never persisted — see the PUT
      // handler, which strips it back out.
      const workspace = process.env['FLEEX_WORKSPACE']?.trim() || undefined;
      return { ...container.config.get(), ...(workspace ? { workspace } : {}) };
    });

    app.put<{ Body: Partial<AppConfig> & { workspace?: string } }>('/api/config', async (request) => {
      // basePath is managed by ~/.fleex/workspaces.json (injected via env at
      // startup), not the DB — ignore any attempt to change it through the API.
      // workspace is likewise env-derived and echoed back on GET, never stored.
      const { basePath: _ignoredBasePath, workspace: _ignoredWorkspace, ...updatable } = request.body;

      // The action registry is the only thing the server will later execute, so
      // it is validated before it can be persisted. Rejecting here means a
      // malformed definition never reaches disk — the run path can therefore
      // trust the shapes it reads back.
      if (updatable.actions !== undefined) {
        const errors = validateActionDefs(updatable.actions);
        if (errors.length > 0) {
          const message = errors.map((e) => `${e.field}: ${e.reason}`).join('; ');
          throw new ActionInvalidParamsError(
            `Invalid actions: ${message}`,
            errors.map((e) => ({ param: e.field, reason: e.reason })),
          );
        }
      }

      await container.config.update(updatable);

      // Auto-resolve repository patterns when repositories change
      if (Array.isArray(request.body.repositories)) {
        const resolved = await container.repositoryResolver.resolve(request.body.repositories);
        await container.config.update({
          resolvedRepositories: resolved,
          resolvedAt: new Date().toISOString(),
        });

        // Trigger a background refresh so the sidebar picks up new repos
        const repos = resolved
          .filter((entry): entry is string => typeof entry === 'string' && entry.includes('/'))
          .map((entry) => {
            const [org, name] = entry.split('/');
            return { org: org!, name: name! };
          });
        container.repositoryRefreshScheduler.setRepos(repos);
        container.repositoryRefreshScheduler.refresh().catch(() => {});

        // Sync bare clones: create new ones, delete removed ones
        container.bareCloneManager.syncWithConfig(repos).catch(() => {});
      }

      return container.config.get();
    });
  };
}
