import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../../application/ports/config.port.js';
import type { Container } from '../container.js';

export function configRoutes(container: Container) {
  return async function (app: FastifyInstance) {
    app.get('/api/config', async () => {
      return container.config.get();
    });

    app.put<{ Body: Partial<AppConfig> }>('/api/config', async (request) => {
      await container.config.update(request.body);

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
      }

      return container.config.get();
    });
  };
}
