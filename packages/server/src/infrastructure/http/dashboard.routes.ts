import type { FastifyInstance } from 'fastify';
import type {
  DashboardPullRequest,
  DashboardWorktree,
  DashboardGitHubIssue,
  DashboardData,
  DashboardStats,
  ActiveRecentTicket,
  NeedsYouItem,
} from '@fleex/shared';
import type { Container } from '../container.js';
import { getDashboardLaunchpad, type LaunchpadResult } from '../../application/use-cases/get-dashboard-launchpad.js';
import { getActiveRecentTickets } from '../../application/use-cases/get-active-recent-tickets.js';

const EMPTY_LAUNCHPAD: LaunchpadResult = {
  liveRuns: 0,
  liveRunsNeedReview: 0,
  needsReview: 0,
  needsReviewFailed: 0,
  deliverablesToday: 0,
  spendTodayUsd: 0,
  needsYou: [],
  inFlight: [],
  recentOutputs: [],
};

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

        // Tickets as DTOs — reused for activeTickets and the launchpad aggregation.
        const ticketDtos = allTickets.map((t) => t.toDTO());
        const activeTickets = ticketDtos.filter((t) => t.status !== 'done' && t.status !== 'cancelled');

        // ── Launchpad: live/agentic half (sessions, executions, deliverables, mentions, workflows, stale) ──
        let launchpad: LaunchpadResult;
        try {
          launchpad = await getDashboardLaunchpad({
            sessionStore: container.sessionStore,
            agentEventStore: container.agentEventStore,
            deliverableStore: container.deliverableStore,
            mentionStore: container.mentionStore,
            personaStore: container.personaStore,
            workflowRunStore: container.workflowRunStore,
            tickets: ticketDtos.map((t) => ({
              id: t.id,
              displayId: t.displayId,
              title: t.title,
              status: t.status,
              updatedAt: t.updatedAt,
            })),
            now: new Date(),
          });
        } catch (e) {
          container.logger.warn('Dashboard launchpad aggregation failed', { error: String(e) });
          launchpad = EMPTY_LAUNCHPAD;
        }

        // ── Active tickets with activity in the last 7 days (replaces "Today's Branches") ──
        let activeRecentTickets: ActiveRecentTicket[] = [];
        try {
          activeRecentTickets = await getActiveRecentTickets({
            tickets: activeTickets.map((t) => ({
              id: t.id,
              displayId: t.displayId,
              title: t.title,
              status: t.status,
              updatedAt: t.updatedAt,
            })),
            commentStore: container.commentStore,
            deliverableStore: container.deliverableStore,
            mentionStore: container.mentionStore,
            now: new Date(),
          });
        } catch (e) {
          container.logger.warn('Dashboard active-recent-tickets aggregation failed', { error: String(e) });
        }

        const myPullRequests: DashboardPullRequest[] = [];
        const reviewRequests: DashboardPullRequest[] = [];
        const myIssues: DashboardGitHubIssue[] = [];
        const assignedIssues: DashboardGitHubIssue[] = [];
        const activeWorktrees: DashboardWorktree[] = [];

        // Skip GitHub fetches if rate-limited — return tickets + launchpad (no GitHub-derived bits)
        if (rateLimited) {
          const stats: DashboardStats = {
            liveRuns: launchpad.liveRuns,
            liveRunsNeedReview: launchpad.liveRunsNeedReview,
            needsReview: launchpad.needsReview,
            needsReviewFailed: launchpad.needsReviewFailed,
            prsMine: 0,
            prsDraft: 0,
            prsConflict: 0,
            deliverablesToday: launchpad.deliverablesToday,
            spendTodayUsd: launchpad.spendTodayUsd,
          };
          return {
            activeTickets,
            myPullRequests,
            reviewRequests,
            myIssues,
            assignedIssues,
            activeWorktrees,
            githubUser,
            stats,
            needsYou: launchpad.needsYou,
            inFlight: launchpad.inFlight,
            recentOutputs: launchpad.recentOutputs,
            activeRecentTickets,
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
                isDraft: pr.isDraft ?? false,
                mergeable: pr.mergeable ?? 'UNKNOWN',
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

        // ── GitHub-derived launchpad bits ──
        const prsDraft = myPullRequests.filter((p) => p.isDraft).length;
        const prsConflict = myPullRequests.filter((p) => p.mergeable === 'CONFLICTING').length;

        const reviewItems: NeedsYouItem[] = reviewRequests.map((pr) => ({
          id: `review:${pr.org}/${pr.name}#${pr.number}`,
          kind: 'review_requested',
          title: `Review requested — ${pr.headRefName} #${pr.number}`,
          subtitle: `${pr.org}/${pr.name}`,
          ticketId: pr.linkedTicketId ?? null,
          ticketDisplayId: null,
          at: pr.updatedAt,
          href: `https://github.com/${pr.org}/${pr.name}/pull/${pr.number}`,
        }));
        const needsYou = [...launchpad.needsYou, ...reviewItems].sort((a, b) => b.at.localeCompare(a.at));

        const stats: DashboardStats = {
          liveRuns: launchpad.liveRuns,
          liveRunsNeedReview: launchpad.liveRunsNeedReview,
          needsReview: launchpad.needsReview,
          needsReviewFailed: launchpad.needsReviewFailed,
          prsMine: myPullRequests.length,
          prsDraft,
          prsConflict,
          deliverablesToday: launchpad.deliverablesToday,
          spendTodayUsd: launchpad.spendTodayUsd,
        };

        return {
          activeTickets,
          myPullRequests,
          reviewRequests,
          myIssues,
          assignedIssues,
          activeWorktrees,
          githubUser,
          stats,
          needsYou,
          inFlight: launchpad.inFlight,
          recentOutputs: launchpad.recentOutputs,
          activeRecentTickets,
        } satisfies DashboardData;
      } catch (err) {
        container.logger.error('Dashboard aggregation failed', { error: String(err) });
        return reply.code(500).send({ error: 'Failed to load dashboard data' });
      }
    });
  };
}
