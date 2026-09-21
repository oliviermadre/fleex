import type { FastifyInstance } from 'fastify';
import type { Container } from '../container.js';

/**
 * Data for the "or browse" pickers of the new-task flow. Separate from
 * `/api/dashboard` on purpose: that route refetches everything live (worktrees,
 * every ticket, two searches) and a picker needs a fraction of it, instantly.
 */
export function importBrowseRoutes(container: Container) {
  return async function (app: FastifyInstance) {
    app.get('/api/import/browse', async () => container.getImportBrowse.inbox());

    app.get<{ Params: { org: string; name: string } }>(
      '/api/import/browse/:org/:name',
      async (request) => container.getImportBrowse.repo(request.params.org, request.params.name),
    );
  };
}
