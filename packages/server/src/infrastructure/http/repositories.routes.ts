import type { FastifyInstance } from 'fastify';
import type { CreateWorktreeRequest, DiffStats, GitHubIssue, GitHubIssueDetail, PullRequest, RepositorySummary, Worktree } from '@fleex/shared';
import { RepositoryCache } from '../../domain/services/repository-cache.js';
import { sanitizeBranchForPath } from '../../domain/services/branch-utils.js';
import type { Container } from '../container.js';

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
          return await container.repositoryResolver.resolve([`${org}/*`]);
        } catch (err) {
          container.logger.warn('Failed to resolve repos via gh CLI', { org, error: String(err) });
          return reply.code(502).send({ error: 'Failed to list repositories from GitHub' });
        }
      },
    );

    app.get<{ Params: { org: string; name: string } }>(
      '/api/repositories/:org/:name/worktrees',
      async (request) => {
        const { org, name } = request.params;
        const barePath = container.resolver.barePath(org, name);
        const exists = await container.hostFs.exists(barePath);
        if (!exists) return [];
        return container.listWorktrees.execute(org, name);
      },
    );

    app.post<{ Params: { org: string; name: string }; Body: CreateWorktreeRequest }>(
      '/api/repositories/:org/:name/worktrees',
      async (request, reply) => {
        const { org, name } = request.params;
        const sanitized = sanitizeBranchForPath(request.body.branch);
        const { prNumber, issueNumber } = request.body;
        let dirName: string;
        if (prNumber) {
          dirName = `${name}.pr-${prNumber}-${sanitized}`;
        } else if (issueNumber) {
          dirName = `${name}.issue-${issueNumber}-${sanitized}`;
        } else {
          dirName = `${name}.${sanitized}`;
        }
        const wtPath = container.resolver.worktreeDir(org, dirName);
        const result = await container.createWorktree.executeWithHook(org, name, wtPath, request.body);
        return reply.code(201).send({
          path: result.existingPath ?? wtPath,
          hookStarted: result.hookStarted,
        });
      },
    );

    app.delete<{ Params: { org: string; name: string }; Body: { path: string } }>(
      '/api/repositories/:org/:name/worktrees',
      async (request, reply) => {
        const { org, name } = request.params;
        const barePath = container.resolver.barePath(org, name);
        await container.git.removeWorktree(barePath, request.body.path);
        return reply.code(204).send();
      },
    );

    app.get<{ Params: { org: string; name: string } }>(
      '/api/repositories/:org/:name/branches',
      async (request) => {
        const { org, name } = request.params;
        const barePath = container.resolver.barePath(org, name);
        const exists = await container.hostFs.exists(barePath);
        if (!exists) return [];
        await container.bareCloneManager.fetch(org, name);
        return container.git.listBranches(barePath);
      },
    );

    app.get<{ Params: { org: string; name: string }; Querystring: { force?: string } }>(
      '/api/repositories/:org/:name/pulls',
      async (request, reply) => {
        const { org, name } = request.params;
        const cacheKey = `pulls:${org}/${name}`;
        if (request.query.force === 'true') {
          container.repositoryCache.invalidate(cacheKey);
        }
        const cached = container.repositoryCache.get<PullRequest[]>(cacheKey);
        if (cached) return cached.data;

        try {
          const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
          const mergedDateStr = thirtyDaysAgo.toISOString().split('T')[0];

          const [openResult, mergedResult] = await Promise.all([
            container.execFn('gh', [
              'pr', 'list',
              '--repo', `${org}/${name}`,
              '--json', 'number,title,headRefName,author,assignees,createdAt,updatedAt',
              '--limit', '50',
              '--state', 'open',
            ], { timeout: 15_000 }),
            container.execFn('gh', [
              'pr', 'list',
              '--repo', `${org}/${name}`,
              '--json', 'number,title,headRefName,author,assignees,createdAt,updatedAt,mergedAt',
              '--limit', '20',
              '--state', 'merged',
              '--search', `merged:>${mergedDateStr}`,
            ], { timeout: 15_000 }),
          ]);

          const rawOpen = JSON.parse(openResult.stdout) as {
            number: number; title: string; headRefName: string;
            author: { login: string }; assignees: { login: string }[];
            createdAt: string; updatedAt: string;
          }[];
          const rawMerged = JSON.parse(mergedResult.stdout) as {
            number: number; title: string; headRefName: string;
            author: { login: string }; assignees: { login: string }[];
            createdAt: string; updatedAt: string; mergedAt: string;
          }[];

          const openPRs = rawOpen.map((pr): PullRequest => ({
            number: pr.number,
            title: pr.title,
            headRefName: pr.headRefName,
            state: 'open',
            author: pr.author.login,
            assignees: pr.assignees.map((a) => a.login),
            createdAt: pr.createdAt,
            updatedAt: pr.updatedAt,
          }));
          const mergedPRs = rawMerged.map((pr): PullRequest => ({
            number: pr.number,
            title: pr.title,
            headRefName: pr.headRefName,
            state: 'merged',
            author: pr.author.login,
            assignees: pr.assignees.map((a) => a.login),
            createdAt: pr.createdAt,
            updatedAt: pr.updatedAt,
            mergedAt: pr.mergedAt,
          }));

          const result = [...openPRs, ...mergedPRs];
          container.repositoryCache.set(cacheKey, result, RepositoryCache.TTL_PULLS);
          return result;
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
          const { stdout } = await container.execFn('gh', [
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

    app.get<{ Params: { org: string; name: string; number: string } }>(
      '/api/repositories/:org/:name/issues/:number',
      async (request, reply) => {
        const { org, name } = request.params;
        const issueNumber = parseInt(request.params.number, 10);
        if (isNaN(issueNumber)) {
          return reply.code(400).send({ error: 'Invalid issue number' });
        }
        try {
          return await container.githubGraphql.fetchIssueDetail(org, name, issueNumber);
        } catch (err) {
          container.logger.warn('Failed to fetch issue detail', { org, name, number: issueNumber, error: String(err) });
          return reply.code(502).send({ error: 'Failed to fetch issue detail from GitHub' });
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
        const barePath = container.resolver.barePath(org, name);
        const exists = await container.hostFs.exists(barePath);
        if (!exists) return {};
        await container.bareCloneManager.fetch(org, name);
        const defaultBranch = await container.git.getDefaultBranch(barePath);
        const base = `origin/${defaultBranch}`;

        const results = await Promise.all(
          branches.map(async (branch): Promise<[string, DiffStats]> => {
            const remoteBranch = `origin/${branch}`;
            const stats = await container.git.getDiffStats(barePath, remoteBranch, base);
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
      async (request, reply) => {
        const { org, name } = request.params;
        const barePath = container.resolver.barePath(org, name);
        const exists = await container.hostFs.exists(barePath);
        if (!exists) return reply.code(404).send({ error: 'Repository not cloned locally' });
        const defaultBranch = await container.git.getDefaultBranch(barePath);
        return {
          defaultBranch,
          currentBranch: defaultBranch,
          isOnDefault: true,
        };
      },
    );

    // ---- Repository Dashboard Endpoints ----

    app.get('/api/repositories/summaries', async () => {
      const configuredRepos = getConfiguredRepos(container);
      const summaries: RepositorySummary[] = [];

      for (const { org, name } of configuredRepos) {
        const key = `${org}/${name}`;
        const barePath = container.resolver.barePath(org, name);
        const isClonedLocally = await container.hostFs.exists(barePath);
        const cached = container.repositoryCache.get<RepositorySummary>(`summary:${key}`);
        if (cached) {
          summaries.push({ ...cached.data, isClonedLocally });
        } else {
          summaries.push({
            org,
            name,
            openIssuesCount: 0,
            myPRsCount: 0,
            assignedPRsCount: 0,
            openPRsCount: 0,
            recentlyMergedPRsCount: 0,
            lastFetchedAt: null,
            isClonedLocally,
          });
        }
      }

      // If cache is cold, trigger background refresh
      if (summaries.every((s) => s.lastFetchedAt === null) && configuredRepos.length > 0) {
        container.repositoryRefreshScheduler.setRepos(configuredRepos);
        container.repositoryRefreshScheduler.refresh().catch(() => {});
      }

      return summaries;
    });

    app.get<{ Params: { org: string; name: string } }>(
      '/api/repositories/:org/:name/dashboard',
      async (request) => {
        const { org, name } = request.params;
        const key = `${org}/${name}`;
        const barePath = container.resolver.barePath(org, name);

        // Try cache first
        const cachedPulls = container.repositoryCache.get<PullRequest[]>(`pulls:${key}`);
        const cachedIssues = container.repositoryCache.get<GitHubIssue[]>(`issues:${key}`);
        const cachedMerged = container.repositoryCache.get<PullRequest[]>(`merged:${key}`);

        let pulls = cachedPulls?.data;
        let issues = cachedIssues?.data;
        let mergedPRs = cachedMerged?.data;

        // If any data is missing, fetch fresh
        if (!pulls || !issues || !mergedPRs) {
          const results = await container.githubGraphql.fetchRepoBatch([{ org, name }]);
          const result = results.get(key);
          if (result) {
            pulls = result.pulls;
            issues = result.issues;
            mergedPRs = result.mergedPRs;
            container.repositoryCache.set(`pulls:${key}`, pulls, RepositoryCache.TTL_PULLS);
            container.repositoryCache.set(`issues:${key}`, issues, RepositoryCache.TTL_ISSUES);
            container.repositoryCache.set(`merged:${key}`, mergedPRs, RepositoryCache.TTL_MERGED);
          } else {
            pulls = pulls ?? [];
            issues = issues ?? [];
            mergedPRs = mergedPRs ?? [];
          }
        }

        // Get worktrees and diff stats (only if bare clone exists)
        const repoExists = await container.hostFs.exists(barePath);
        let worktrees: Worktree[] = [];
        const diffStats: Record<string, DiffStats> = {};

        if (repoExists) {
          worktrees = await container.listWorktrees.execute(org, name);
          const nonBareWorktrees = worktrees.filter((wt) => !wt.isBare);

          if (nonBareWorktrees.length > 0) {
            const defaultBranch = await container.git.getDefaultBranch(barePath);
            const base = `origin/${defaultBranch}`;

            const results = await Promise.all(
              nonBareWorktrees.map(async (wt): Promise<[string, DiffStats]> => {
                const remoteBranch = `origin/${wt.branch}`;
                const stats = await container.git.getDiffStats(barePath, remoteBranch, base);
                return [wt.branch, stats];
              }),
            );

            for (const [branch, stats] of results) {
              diffStats[branch] = stats;
            }
          }
        }

        const githubUser = await container.githubGraphql.getCurrentUser();

        return {
          org,
          name,
          openIssues: issues,
          openPullRequests: pulls,
          recentlyMergedPullRequests: mergedPRs,
          worktrees,
          diffStats,
          githubUser,
          isClonedLocally: repoExists,
        };
      },
    );

    app.get<{ Params: { org: string; name: string } }>(
      '/api/repositories/:org/:name/merged-pulls',
      async (request, reply) => {
        const { org, name } = request.params;
        const key = `${org}/${name}`;
        const cached = container.repositoryCache.get<PullRequest[]>(`merged:${key}`);
        if (cached) return cached.data;

        try {
          const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
          const dateStr = sevenDaysAgo.toISOString().split('T')[0];
          const { stdout } = await container.execFn('gh', [
            'pr', 'list', '--repo', `${org}/${name}`,
            '--json', 'number,title,headRefName,author,assignees,createdAt,updatedAt,mergedAt',
            '--limit', '20', '--state', 'merged', '--search', `merged:>${dateStr}`,
          ], { timeout: 15_000 });
          const raw = JSON.parse(stdout) as {
            number: number; title: string; headRefName: string;
            author: { login: string }; assignees: { login: string }[];
            createdAt: string; updatedAt: string; mergedAt: string;
          }[];
          const result: PullRequest[] = raw.map((pr) => ({
            number: pr.number,
            title: pr.title,
            headRefName: pr.headRefName,
            state: 'merged' as const,
            author: pr.author.login,
            assignees: pr.assignees.map((a) => a.login),
            createdAt: pr.createdAt,
            updatedAt: pr.updatedAt,
            mergedAt: pr.mergedAt,
          }));
          container.repositoryCache.set(`merged:${key}`, result, RepositoryCache.TTL_MERGED);
          return result;
        } catch (err) {
          container.logger.warn('Failed to list merged PRs', { org, name, error: String(err) });
          return reply.code(502).send({ error: 'Failed to list merged pull requests' });
        }
      },
    );

    app.post<{ Body: { scope: 'all' | 'repo'; org?: string; name?: string } }>(
      '/api/repositories/refresh',
      async (request, reply) => {
        const { scope, org, name } = request.body;

        // Use configured repos, not filesystem scan
        const configuredRepos = getConfiguredRepos(container);
        container.repositoryRefreshScheduler.setRepos(configuredRepos);

        const target = scope === 'repo' && org && name ? { org, name } : undefined;
        container.repositoryRefreshScheduler.refresh(target).catch((err) => {
          container.logger.error('Manual refresh failed', { error: String(err) });
        });

        return reply.code(202).send({ status: 'refreshing' });
      },
    );

    app.get('/api/github/user', async () => {
      const cached = container.repositoryCache.get<string>('github:user');
      if (cached) return { login: cached.data };

      const login = await container.githubGraphql.getCurrentUser();
      container.repositoryCache.set('github:user', login, RepositoryCache.TTL_USER);
      return { login };
    });

    // ---- Clone endpoints ----

    app.get<{ Querystring: { org: string; name: string } }>(
      '/api/repositories/check-cwd',
      async (request, reply) => {
        const { org, name } = request.query;
        if (!org || !name) {
          return reply.code(400).send({ error: 'org and name query parameters are required' });
        }
        const barePath = container.resolver.barePath(org, name);
        const exists = await container.hostFs.exists(barePath);
        if (exists) {
          return { exists: true };
        }
        const gitHost = getGitHost(container);
        const remote = `git@${gitHost}:${org}/${name}`;
        return { exists: false, remote, targetPath: barePath };
      },
    );

    app.post<{ Body: { org: string; name: string } }>(
      '/api/repositories/clone',
      async (request, reply) => {
        const { org, name } = request.body;
        if (!org || !name) {
          return reply.code(400).send({ error: 'org and name are required' });
        }

        // Security: only allow cloning repos that are configured in settings
        const configuredRepos = getConfiguredRepos(container);
        const isAllowed = configuredRepos.some((r) => r.org === org && r.name === name);
        if (!isAllowed) {
          return reply.code(403).send({
            code: 'REPO_NOT_CONFIGURED',
            message: `Repository ${org}/${name} is not in the configured repositories list`,
          });
        }

        const gitHost = getGitHost(container);
        const remote = `git@${gitHost}:${org}/${name}`;

        try {
          await container.bareCloneManager.ensureBareClone(org, name, remote);
          return { success: true };
        } catch (err) {
          const stderr = (err as any)?.stderr ?? String(err);
          container.logger.warn('bare clone failed', { org, name, remote, error: stderr });
          return reply.code(422).send({
            code: 'CLONE_FAILED',
            message: stderr || `Failed to clone ${remote}`,
          });
        }
      },
    );
  };
}

function getGitHost(container: Container): string {
  const config = container.config.get() as unknown as Record<string, unknown>;
  const gitHost = config['gitHost'];
  return typeof gitHost === 'string' && gitHost ? gitHost : 'github.com';
}

function getConfiguredRepos(container: Container): { org: string; name: string }[] {
  const config = container.config.get() as unknown as Record<string, unknown>;
  const resolved = config['resolvedRepositories'];
  if (!Array.isArray(resolved)) return [];

  return resolved
    .filter((entry): entry is string => typeof entry === 'string' && entry.includes('/'))
    .map((entry) => {
      const [org, name] = entry.split('/');
      return { org: org!, name: name! };
    });
}
