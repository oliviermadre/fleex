import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { FastifyInstance } from 'fastify';
import type { CreateWorktreeRequest, PullRequest } from '@asm/shared';
import type { Container } from '../container.js';

const execFileAsync = promisify(execFile);

function sanitizeBranchForPath(branch: string): string {
  return branch.toLowerCase()
    .replace(/[/_\s]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

export function repositoryRoutes(container: Container) {
  return async function (app: FastifyInstance) {
    app.get('/api/repositories', async () => {
      return container.listRepositories.execute();
    });

    app.get<{ Querystring: { org: string } }>(
      '/api/repositories/resolve',
      async (request, reply) => {
        const org = request.query.org;
        if (!org) {
          return reply.code(400).send({ error: 'org query parameter is required' });
        }
        try {
          const { stdout } = await execFileAsync('gh', [
            'repo', 'list', org,
            '--json', 'nameWithOwner',
            '--limit', '200',
          ], { timeout: 15_000 });
          const repos = JSON.parse(stdout) as { nameWithOwner: string }[];
          return repos.map((r) => r.nameWithOwner.toLowerCase());
        } catch (err) {
          container.logger.warn('Failed to resolve repos via gh CLI', { org, error: String(err) });
          return reply.code(502).send({ error: 'Failed to list repositories from GitHub' });
        }
      },
    );

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
        const sanitized = sanitizeBranchForPath(request.body.branch);
        const wtPath = join(repoPath, '..', `${request.params.name}.${sanitized}`);
        const existingPath = await container.createWorktree.execute(repoPath, wtPath, request.body);
        return reply.code(201).send({ path: existingPath ?? wtPath });
      },
    );

    app.get<{ Params: { org: string; name: string } }>(
      '/api/repositories/:org/:name/branches',
      async (request) => {
        const repoPath = resolveRepoPath(container, request.params.org, request.params.name);
        return container.git.listBranches(repoPath);
      },
    );

    app.get<{ Params: { org: string; name: string } }>(
      '/api/repositories/:org/:name/pulls',
      async (request, reply) => {
        const { org, name } = request.params;
        try {
          const { stdout } = await execFileAsync('gh', [
            'pr', 'list',
            '--repo', `${org}/${name}`,
            '--json', 'number,title,headRefName',
            '--limit', '50',
            '--state', 'open',
          ], { timeout: 15_000 });
          return JSON.parse(stdout) as PullRequest[];
        } catch (err) {
          container.logger.warn('Failed to list PRs via gh CLI', { org, name, error: String(err) });
          return reply.code(502).send({ error: 'Failed to list pull requests from GitHub' });
        }
      },
    );

    app.get<{ Params: { org: string; name: string } }>(
      '/api/repositories/:org/:name/default-branch',
      async (request) => {
        const repoPath = resolveRepoPath(container, request.params.org, request.params.name);
        const defaultBranch = await container.git.getDefaultBranch(repoPath);
        const info = await container.git.getInfo(repoPath);
        return {
          defaultBranch,
          currentBranch: info.branch,
          isOnDefault: info.branch === defaultBranch,
        };
      },
    );
  };
}

function resolveRepoPath(container: Container, org: string, name: string): string {
  const basePath = container.config.get().repositoriesBasePath.replace(/^~/, homedir());
  return join(basePath, org, name);
}
