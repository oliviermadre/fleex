import { join } from 'node:path';
import { homedir } from 'node:os';
import type { FastifyInstance } from 'fastify';
import type { CreateWorktreeRequest } from '@asm/shared';
import type { Container } from '../container.js';

export function repositoryRoutes(container: Container) {
  return async function (app: FastifyInstance) {
    app.get('/api/repositories', async () => {
      return container.listRepositories.execute();
    });

    app.get<{ Params: { org: string; name: string } }>(
      '/api/repositories/:org/:name/worktrees',
      async (request) => {
        const repoPath = resolveRepoPath(container, request.params.org, request.params.name);
        return container.listWorktrees.execute(repoPath);
      },
    );

    app.post<{ Params: { org: string; name: string }; Body: CreateWorktreeRequest }>(
      '/api/repositories/:org/:name/worktrees',
      async (request, reply) => {
        const repoPath = resolveRepoPath(container, request.params.org, request.params.name);
        const wtPath = join(repoPath, '..', `${request.params.name}-${request.body.branch}`);
        await container.createWorktree.execute(repoPath, wtPath, request.body);
        return reply.code(201).send({ path: wtPath });
      },
    );

    app.get<{ Params: { org: string; name: string } }>(
      '/api/repositories/:org/:name/branches',
      async (request) => {
        const repoPath = resolveRepoPath(container, request.params.org, request.params.name);
        return container.git.listBranches(repoPath);
      },
    );
  };
}

function resolveRepoPath(container: Container, org: string, name: string): string {
  const basePath = container.config.get().repositoriesBasePath.replace(/^~/, homedir());
  return join(basePath, org, name);
}
