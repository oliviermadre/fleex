import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { FastifyInstance } from 'fastify';
import type { CreateWorktreeRequest, DiffStats, GitHubIssue, PullRequest } from '@asm/shared';
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
        const { prNumber, issueNumber } = request.body;
        let dirName: string;
        if (prNumber) {
          dirName = `${request.params.name}.pr-${prNumber}-${sanitized}`;
        } else if (issueNumber) {
          dirName = `${request.params.name}.issue-${issueNumber}-${sanitized}`;
        } else {
          dirName = `${request.params.name}.${sanitized}`;
        }
        const wtPath = join(repoPath, '..', dirName);
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
            '--json', 'number,title,headRefName,author,assignees,createdAt,updatedAt',
            '--limit', '50',
            '--state', 'open',
          ], { timeout: 15_000 });
          const raw = JSON.parse(stdout) as {
            number: number;
            title: string;
            headRefName: string;
            author: { login: string };
            assignees: { login: string }[];
            createdAt: string;
            updatedAt: string;
          }[];
          return raw.map((pr): PullRequest => ({
            number: pr.number,
            title: pr.title,
            headRefName: pr.headRefName,
            author: pr.author.login,
            assignees: pr.assignees.map((a) => a.login),
            createdAt: pr.createdAt,
            updatedAt: pr.updatedAt,
          }));
        } catch (err) {
          container.logger.warn('Failed to list PRs via gh CLI', { org, name, error: String(err) });
          return reply.code(502).send({ error: 'Failed to list pull requests from GitHub' });
        }
      },
    );

    app.get<{ Params: { org: string; name: string } }>(
      '/api/repositories/:org/:name/issues',
      async (request, reply) => {
        const { org, name } = request.params;
        try {
          const { stdout } = await execFileAsync('gh', [
            'issue', 'list',
            '--repo', `${org}/${name}`,
            '--assignee', '@me',
            '--json', 'number,title,author,createdAt,updatedAt',
            '--state', 'open',
            '--limit', '50',
          ], { timeout: 15_000 });
          const raw = JSON.parse(stdout) as {
            number: number;
            title: string;
            author: { login: string };
            createdAt: string;
            updatedAt: string;
          }[];
          return raw.map((issue): GitHubIssue => ({
            number: issue.number,
            title: issue.title,
            author: issue.author.login,
            createdAt: issue.createdAt,
            updatedAt: issue.updatedAt,
          }));
        } catch (err) {
          container.logger.warn('Failed to list issues via gh CLI', { org, name, error: String(err) });
          return reply.code(502).send({ error: 'Failed to list issues from GitHub' });
        }
      },
    );

    app.get<{ Params: { org: string; name: string }; Querystring: { branches: string } }>(
      '/api/repositories/:org/:name/diff-stats',
      async (request, reply) => {
        const { org, name } = request.params;
        const branchesParam = request.query.branches;
        if (!branchesParam) {
          return reply.code(400).send({ error: 'branches query parameter is required' });
        }
        const branches = branchesParam.split(',').slice(0, 20);
        const repoPath = resolveRepoPath(container, org, name);
        await container.git.fetch(repoPath).catch(() => {});
        const defaultBranch = await container.git.getDefaultBranch(repoPath);
        const base = `origin/${defaultBranch}`;

        const results = await Promise.all(
          branches.map(async (branch): Promise<[string, DiffStats]> => {
            const remoteBranch = `origin/${branch}`;
            const stats = await container.git.getDiffStats(repoPath, remoteBranch, base);
            return [branch, stats];
          }),
        );

        const record: Record<string, DiffStats> = {};
        for (const [branch, stats] of results) {
          record[branch] = stats;
        }
        return record;
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
