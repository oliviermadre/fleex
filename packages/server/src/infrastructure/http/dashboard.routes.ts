import type { FastifyInstance } from 'fastify';
import type { DashboardPullRequest, DashboardWorktree, DashboardGitHubIssue, DashboardData } from '@fleex/shared';
import type { Container } from '../container.js';

// Raw shape returned by `gh search issues --json ...`
interface GhSearchIssue {
  number: number;
  title: string;
  author: { login: string };
  assignees: { login: string }[];
  repository: { name: string; nameWithOwner: string };
  createdAt: string;
  updatedAt: string;
}

export function dashboardRoutes(container: Container) {
  return async function (app: FastifyInstance) {
    app.get('/api/dashboard', async (_request, reply) => {
      try {
        // Get configured repos
        const config = container.config.get() as unknown as Record<string, unknown>;
        const resolved = config['resolvedRepositories'];
        const configuredRepos: { org: string; name: string }[] = [];
        if (Array.isArray(resolved)) {
          for (const entry of resolved) {
            if (typeof entry === 'string' && entry.includes('/')) {
              const [org, name] = entry.split('/');
              configuredRepos.push({ org: org!, name: name! });
            }
          }
        }

        // Check rate limit before making GitHub API calls
        let rateLimited = false;
        try {
          const rateLimit = await container.githubGraphql.getRateLimit();
          if (rateLimit.remaining < 100) {
            container.logger.warn('GitHub rate limit low, dashboard will skip GitHub fetches', { remaining: rateLimit.remaining });
            rateLimited = true;
          }
        } catch {
          // rate limit check failed, proceed cautiously
        }

        // Get GitHub user + all tickets in parallel
        const [githubUser, allTickets] = await Promise.all([
          container.githubGraphql.getCurrentUser(),
          container.ticketStore.getAllTickets(),
        ]);

        // Build maps from ticket links → ticketId
        const localIssueMap = new Map<string, string>();
        const localPRMap = new Map<string, string>();
        const worktreeBranchMap = new Map<string, string>();
        for (const ticket of allTickets) {
          for (const link of ticket.links) {
            if (link.type === 'github_issue') {
              localIssueMap.set(link.ref, ticket.id);
            } else if (link.type === 'github_pr') {
              localPRMap.set(link.ref, ticket.id);
            } else if (link.type === 'worktree') {
              worktreeBranchMap.set(link.ref, ticket.id);
            }
          }
        }

        const myPullRequests: DashboardPullRequest[] = [];
        const reviewRequests: DashboardPullRequest[] = [];
        const myIssues: DashboardGitHubIssue[] = [];
        const assignedIssues: DashboardGitHubIssue[] = [];
        const activeWorktrees: DashboardWorktree[] = [];

        // Skip GitHub fetches if rate-limited — return tickets-only dashboard
        if (rateLimited) {
          const activeTickets = allTickets
            .filter((t) => t.status !== 'done' && t.status !== 'cancelled')
            .map((t) => t.toDTO());
          return {
            activeTickets,
            myPullRequests,
            reviewRequests,
            myIssues,
            assignedIssues,
            activeWorktrees,
            githubUser,
          } satisfies DashboardData;
        }

        // Case-insensitive lookup: GitHub returns canonical casing, we need configured casing
        const repoLookup = new Map<string, { org: string; name: string }>();
        for (const r of configuredRepos) {
          repoLookup.set(`${r.org}/${r.name}`.toLowerCase(), r);
        }

        // ── Fetch everything in parallel: batch PRs + global issues + worktrees ──
        const repoFlags = configuredRepos.flatMap(({ org, name }) => ['--repo', `${org}/${name}`]);
        const issueJsonFields = 'number,title,author,assignees,repository,createdAt,updatedAt';

        const [
          batchPRsResult,
          authoredIssuesResult,
          assignedIssuesResult,
          ...worktreeResults
        ] = await Promise.allSettled([
          // 1 GraphQL call for all repos' PRs (batch up to 8)
          configuredRepos.length > 0
            ? container.githubGraphql.fetchRepoBatch(configuredRepos)
            : Promise.resolve(new Map()),
          // 1 gh search call for authored issues
          configuredRepos.length > 0
            ? container.execFn('gh', [
                'search', 'issues',
                '--author', '@me',
                '--state', 'open',
                ...repoFlags,
                '--json', issueJsonFields,
                '--limit', '50',
              ], { timeout: 20_000 })
            : Promise.resolve({ stdout: '[]', stderr: '', exitCode: 0 }),
          // 1 gh search call for assigned issues
          configuredRepos.length > 0
            ? container.execFn('gh', [
                'search', 'issues',
                '--assignee', '@me',
                '--state', 'open',
                ...repoFlags,
                '--json', issueJsonFields,
                '--limit', '50',
              ], { timeout: 20_000 })
            : Promise.resolve({ stdout: '[]', stderr: '', exitCode: 0 }),
          // Per-repo worktree listing (local git, no API calls)
          ...configuredRepos.map(async ({ org, name }) => {
            const barePath = container.resolver.barePath(org, name);
            const exists = await container.hostFs.exists(barePath);
            if (!exists) return { org, name, worktrees: [] as DashboardWorktree[] };
            const wts = await container.listWorktrees.execute(org, name);
            return {
              org,
              name,
              worktrees: wts
                .filter((wt) => !wt.isBare && !wt.isMain)
                .map((wt) => ({ ...wt, org, name })),
            };
          }),
        ]);

        // ── Process batch PR results (1 GraphQL call covered all repos) ──
        if (batchPRsResult.status === 'fulfilled') {
          const batchResults = batchPRsResult.value as Map<string, import('../../infrastructure/adapters/github-graphql.adapter.js').RepoBatchResult>;
          for (const [key, result] of batchResults) {
            const repo = repoLookup.get(key.toLowerCase());
            if (!repo) continue;
            const { org, name } = repo;

            for (const pr of result.pulls) {
              const mapped: DashboardPullRequest = {
                number: pr.number,
                title: pr.title,
                headRefName: pr.headRefName,
                state: 'open',
                author: pr.author,
                assignees: pr.assignees,
                createdAt: pr.createdAt,
                updatedAt: pr.updatedAt,
                org,
                name,
              };

              if (pr.author === githubUser) {
                myPullRequests.push(mapped);
              } else if (
                pr.assignees.some((a) => a === githubUser) ||
                pr.reviewRequests?.some((r) => r === githubUser)
              ) {
                reviewRequests.push(mapped);
              }
            }
          }
        } else {
          container.logger.warn('Failed to fetch PR batch for dashboard', { error: String((batchPRsResult as PromiseRejectedResult).reason) });
        }

        // ── Process global issue search results ──
        const seenIssueKeys = new Set<string>();

        const buildIssueFromSearch = (raw: GhSearchIssue): DashboardGitHubIssue | null => {
          const nwo = raw.repository.nameWithOwner.toLowerCase();
          const repo = repoLookup.get(nwo);
          if (!repo) return null;
          const ref = `${repo.org}/${repo.name}#${raw.number}`;
          return {
            number: raw.number,
            title: raw.title,
            author: raw.author.login,
            assignees: raw.assignees.map((a) => a.login),
            createdAt: raw.createdAt,
            updatedAt: raw.updatedAt,
            org: repo.org,
            name: repo.name,
            hasLocalTicket: localIssueMap.has(ref),
            linkedTicketId: localIssueMap.get(ref),
          };
        };

        if (authoredIssuesResult.status === 'fulfilled') {
          try {
            const rawIssues = JSON.parse(authoredIssuesResult.value.stdout) as GhSearchIssue[];
            for (const raw of rawIssues) {
              const issue = buildIssueFromSearch(raw);
              if (!issue) continue;
              const key = `${issue.org}/${issue.name}#${issue.number}`;
              seenIssueKeys.add(key);
              myIssues.push(issue);
            }
          } catch {
            container.logger.warn('Failed to parse authored issues search');
          }
        }

        if (assignedIssuesResult.status === 'fulfilled') {
          try {
            const rawIssues = JSON.parse(assignedIssuesResult.value.stdout) as GhSearchIssue[];
            for (const raw of rawIssues) {
              const issue = buildIssueFromSearch(raw);
              if (!issue) continue;
              const key = `${issue.org}/${issue.name}#${issue.number}`;
              if (seenIssueKeys.has(key)) continue;
              assignedIssues.push(issue);
            }
          } catch {
            container.logger.warn('Failed to parse assigned issues search');
          }
        }

        // ── Process worktree results (local git, no API calls) ──
        for (const result of worktreeResults) {
          if (result.status === 'fulfilled') {
            const { worktrees } = result.value as { org: string; name: string; worktrees: DashboardWorktree[] };
            activeWorktrees.push(...worktrees);
          }
        }

        // Populate linkedTicketId for PRs that already have a linked ticket
        for (const pr of [...myPullRequests, ...reviewRequests]) {
          const prRef = `${pr.org}/${pr.name}#${pr.number}`;
          const wtRef = `${pr.org}/${pr.name}:${pr.headRefName}`;
          const existingId = localPRMap.get(prRef) ?? worktreeBranchMap.get(wtRef);
          if (existingId) {
            pr.linkedTicketId = existingId;
          }
        }

        // Return all non-terminal tickets so linked items can always resolve their ticket
        const activeTickets = allTickets
          .filter((t) => t.status !== 'done' && t.status !== 'cancelled')
          .map((t) => t.toDTO());

        return {
          activeTickets,
          myPullRequests,
          reviewRequests,
          myIssues,
          assignedIssues,
          activeWorktrees,
          githubUser,
        } satisfies DashboardData;
      } catch (err) {
        container.logger.error('Dashboard aggregation failed', { error: String(err) });
        return reply.code(500).send({ error: 'Failed to load dashboard data' });
      }
    });
  };
}
