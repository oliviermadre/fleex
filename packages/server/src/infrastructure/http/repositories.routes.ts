import type { FastifyInstance } from 'fastify';
import type { DiffStats, GitHubIssue, GitHubIssueDetail, PullRequest, RepoDiscovery, RepositorySummary, Worktree, WorktreeTicketRef } from '@fleex/shared';
import { RepositoryCache } from '../../domain/services/repository-cache.js';
import { parseTicketBranch } from '../../domain/services/worktree-ticket-resolver.js';
import { GetRepositoryStatsUseCase } from '../../application/use-cases/get-repository-stats.js';
import type { TicketEntity } from '../../domain/entities/ticket.entity.js';
import type { Container } from '../container.js';

export function repositoryRoutes(container: Container) {
  const getRepositoryStats = new GetRepositoryStatsUseCase(container.ticketStore, container.agentEventStore);

  /**
   * Resolve each non-bare/non-main worktree to its Fleex ticket. Authoritative
   * source is the worktree's `.fleex.json` manifest; falls back to the
   * branch-name convention (ticket/<hex> or agent/<displayId>). Both id lookups
   * span archived tickets, so done/cancelled worktrees still resolve after the
   * session ends. Worktrees with no resolvable ticket are simply omitted.
   */
  async function resolveWorktreeTickets(worktrees: Worktree[]): Promise<WorktreeTicketRef[]> {
    const targets = worktrees.filter((wt) => !wt.isBare && !wt.isMain);
    if (targets.length === 0) return [];

    let allTickets: TicketEntity[] | null = null;
    const getAll = async () => (allTickets ??= await container.ticketStore.getAllTickets());

    const resolveOne = async (wt: Worktree): Promise<TicketEntity | null> => {
      const manifest = container.resolver.resolveManifest(wt.path);
      if (manifest?.ticketId) {
        const byId = await container.ticketStore.getTicketById(manifest.ticketId);
        if (byId) return byId;
      }
      const parsed = parseTicketBranch(wt.branch);
      if (parsed && 'displayId' in parsed) {
        const byDisplay = await container.ticketStore.getTicketByDisplayId(parsed.displayId);
        if (byDisplay) return byDisplay;
      }
      if (parsed && 'idPrefix' in parsed) {
        const all = await getAll();
        const match = all.find((t) => t.id.toLowerCase().startsWith(parsed.idPrefix));
        if (match) return match;
      }
      return null;
    };

    const resolved = await Promise.all(targets.map(async (wt) => ({ wt, ticket: await resolveOne(wt) })));
    return resolved
      .filter((r): r is { wt: Worktree; ticket: TicketEntity } => r.ticket !== null)
      .map(({ wt, ticket }) => ({
        worktreePath: wt.path,
        id: ticket.id,
        displayId: ticket.displayId,
        title: ticket.title,
        status: ticket.status,
        type: ticket.type,
        priority: ticket.priority,
        boardId: ticket.boardId,
      }));
  }

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


    app.delete<{ Params: { org: string; name: string }; Body: { path: string } }>(
      '/api/repositories/:org/:name/worktrees',
      async (request, reply) => {
        const { org, name } = request.params;
        const barePath = container.resolver.barePath(org, name);
        // Resolve the branch before removal so the audit event is informative.
        let branch: string | undefined;
        try {
          const worktrees = await container.git.listWorktrees(barePath);
          branch = worktrees.find((wt) => wt.path === request.body.path)?.branch;
        } catch {
          // Best-effort — don't block deletion on a failed branch lookup.
        }
        await container.git.removeWorktree(barePath, request.body.path);
        container.eventBus.emit({
          type: 'worktree.deleted',
          repoPath: barePath,
          worktreePath: request.body.path,
          ...(branch ? { branch } : {}),
          occurredAt: new Date(),
        });
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
        // Dedicated cache key: this route serves the sidebar with a MIXED list
        // (open+merged+closed) indexed by branch. It must NOT share `pulls:${key}`,
        // which the dashboard reads as open-only — sharing it leaked merged/closed
        // PRs into the dashboard's openPullRequests (duplicate rows).
        const cacheKey = `pulls-all:${org}/${name}`;
        if (request.query.force === 'true') {
          container.repositoryCache.invalidate(cacheKey);
        }
        const cached = container.repositoryCache.get<PullRequest[]>(cacheKey);
        if (cached) return cached.data;

        // Check rate limit before making API calls
        try {
          const rateLimit = await container.githubGraphql.getRateLimit();
          if (rateLimit.remaining < 100) {
            container.logger.warn('GitHub rate limit low, skipping PR fetch', { org, name, remaining: rateLimit.remaining });
            return [];
          }
        } catch {
          // rate limit check failed, proceed cautiously
        }

        try {
          const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
          const mergedDateStr = thirtyDaysAgo.toISOString().split('T')[0];

          const [openResult, mergedResult, closedResult] = await Promise.all([
            container.execFn('gh', [
              'pr', 'list',
              '--repo', `${org}/${name}`,
              '--json', 'number,title,headRefName,isDraft,author,assignees,createdAt,updatedAt',
              '--limit', '50',
              '--state', 'open',
            ], { timeout: 15_000 }),
            container.execFn('gh', [
              'pr', 'list',
              '--repo', `${org}/${name}`,
              '--json', 'number,title,headRefName,isDraft,author,assignees,createdAt,updatedAt,mergedAt',
              '--limit', '20',
              '--state', 'merged',
              '--search', `merged:>${mergedDateStr}`,
            ], { timeout: 15_000 }),
            container.execFn('gh', [
              'pr', 'list',
              '--repo', `${org}/${name}`,
              '--json', 'number,title,headRefName,isDraft,author,assignees,createdAt,updatedAt',
              '--limit', '20',
              '--state', 'closed',
              '--search', `-is:merged closed:>${mergedDateStr}`,
            ], { timeout: 15_000 }),
          ]);

          const rawOpen = JSON.parse(openResult.stdout) as {
            number: number; title: string; headRefName: string; isDraft: boolean;
            author: { login: string }; assignees: { login: string }[];
            createdAt: string; updatedAt: string;
          }[];
          const rawMerged = JSON.parse(mergedResult.stdout) as {
            number: number; title: string; headRefName: string; isDraft: boolean;
            author: { login: string }; assignees: { login: string }[];
            createdAt: string; updatedAt: string; mergedAt: string;
          }[];
          const rawClosed = JSON.parse(closedResult.stdout) as {
            number: number; title: string; headRefName: string; isDraft: boolean;
            author: { login: string }; assignees: { login: string }[];
            createdAt: string; updatedAt: string;
          }[];

          const openPRs = rawOpen.map((pr): PullRequest => ({
            number: pr.number,
            title: pr.title,
            headRefName: pr.headRefName,
            state: 'open',
            isDraft: pr.isDraft,
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
            isDraft: pr.isDraft,
            author: pr.author.login,
            assignees: pr.assignees.map((a) => a.login),
            createdAt: pr.createdAt,
            updatedAt: pr.updatedAt,
            mergedAt: pr.mergedAt,
          }));
          const closedPRs = rawClosed.map((pr): PullRequest => ({
            number: pr.number,
            title: pr.title,
            headRefName: pr.headRefName,
            state: 'closed',
            isDraft: pr.isDraft,
            author: pr.author.login,
            assignees: pr.assignees.map((a) => a.login),
            createdAt: pr.createdAt,
            updatedAt: pr.updatedAt,
          }));

          const result = [...openPRs, ...mergedPRs, ...closedPRs];
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
            '--json', 'number,title,state,author,assignees,labels,comments,createdAt,updatedAt,closedAt',
            '--state', 'open',
            '--limit', '50',
          ], { timeout: 15_000 });
          const raw = JSON.parse(stdout) as {
            number: number;
            title: string;
            state: string;
            author: { login: string };
            assignees: { login: string }[];
            labels: { name: string; color: string }[];
            comments: unknown[];
            createdAt: string;
            updatedAt: string;
            closedAt: string | null;
          }[];
          return raw.map((issue): GitHubIssue => ({
            number: issue.number,
            title: issue.title,
            state: issue.state?.toLowerCase() === 'closed' ? 'closed' : 'open',
            author: issue.author.login,
            assignees: issue.assignees.map((a) => a.login),
            labels: (issue.labels ?? []).map((l) => ({ name: l.name, color: l.color })),
            commentsCount: Array.isArray(issue.comments) ? issue.comments.length : 0,
            createdAt: issue.createdAt,
            updatedAt: issue.updatedAt,
            ...(issue.closedAt ? { closedAt: issue.closedAt } : {}),
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
        const cachedClosedIssues = container.repositoryCache.get<GitHubIssue[]>(`closedIssues:${key}`);
        const cachedMerged = container.repositoryCache.get<PullRequest[]>(`merged:${key}`);

        let pulls = cachedPulls?.data;
        let issues = cachedIssues?.data;
        let closedIssues = cachedClosedIssues?.data;
        let mergedPRs = cachedMerged?.data;

        // If any data is missing, fetch fresh
        if (!pulls || !issues || !closedIssues || !mergedPRs) {
          const results = await container.githubGraphql.fetchRepoBatch([{ org, name }]);
          const result = results.get(key);
          if (result) {
            pulls = result.pulls;
            issues = result.issues;
            closedIssues = result.closedIssues;
            mergedPRs = result.mergedPRs;
            container.repositoryCache.set(`pulls:${key}`, pulls, RepositoryCache.TTL_PULLS);
            container.repositoryCache.set(`issues:${key}`, issues, RepositoryCache.TTL_ISSUES);
            container.repositoryCache.set(`closedIssues:${key}`, closedIssues, RepositoryCache.TTL_ISSUES);
            container.repositoryCache.set(`merged:${key}`, mergedPRs, RepositoryCache.TTL_MERGED);
          } else {
            pulls = pulls ?? [];
            issues = issues ?? [];
            closedIssues = closedIssues ?? [];
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

        const worktreeTickets = await resolveWorktreeTickets(worktrees);

        return {
          org,
          name,
          openIssues: issues,
          recentlyClosedIssues: closedIssues,
          openPullRequests: pulls,
          recentlyMergedPullRequests: mergedPRs,
          worktrees,
          worktreeTickets,
          diffStats,
          githubUser,
          isClonedLocally: repoExists,
        };
      },
    );

    app.get<{ Params: { org: string; name: string }; Querystring: { days?: string } }>(
      '/api/repositories/:org/:name/stats',
      async (request) => {
        const { org, name } = request.params;
        const parsed = Number(request.query.days);
        const floored = Math.floor(parsed);
        const days = Number.isFinite(parsed) && floored >= 1 && floored <= 365 ? floored : 30;
        return getRepositoryStats.execute(org, name, days);
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

    app.get('/api/github/discovery', async (_request, reply) => {
      const cached = container.repositoryCache.get<RepoDiscovery>('github:discovery');
      if (cached) return cached.data;
      try {
        const discovery = await container.githubDiscovery.discover();
        container.repositoryCache.set('github:discovery', discovery, RepositoryCache.TTL_DISCOVERY);
        return discovery;
      } catch (err) {
        container.logger.warn('GitHub discovery failed', { error: String(err) });
        return reply.code(502).send({ error: 'GitHub CLI not authenticated or unavailable' });
      }
    });

    app.get<{ Querystring: { repo?: string } }>('/api/github/verify-repo', async (request, reply) => {
      const repo = request.query.repo?.trim().toLowerCase() ?? '';
      if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
        return reply.code(400).send({ error: 'repo must be owner/repo' });
      }
      return container.githubDiscovery.verifyRepo(repo);
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
