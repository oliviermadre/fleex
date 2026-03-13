import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { DashboardPullRequest, DashboardWorktree, DashboardGitHubIssue, DashboardData, PullRequest, GitHubIssue } from '@fleex/shared';
import { BoardEntity } from '../../domain/entities/board.entity.js';
import type { Container } from '../container.js';

const PR_BACKFILL_BOARD_NAME = 'PR Backfill';
const TO_REVIEW_BOARD_NAME = 'To Review';

export function dashboardRoutes(container: Container) {
  return async function (app: FastifyInstance) {
    app.get('/api/dashboard', async (_request, reply) => {
      try {
        // Get configured repos (same pattern as repositories.routes.ts)
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

        // Fetch PRs, issues, worktrees per repo in parallel
        const myPullRequests: DashboardPullRequest[] = [];
        const reviewRequests: DashboardPullRequest[] = [];
        const assignedIssues: DashboardGitHubIssue[] = [];
        const activeWorktrees: DashboardWorktree[] = [];

        await Promise.all(
          configuredRepos.map(async ({ org, name }) => {
            const basePath = container.config.get().basePath;
            const repoPath = join(basePath, org, name);

            // Fetch PRs, issues, worktrees in parallel per repo
            const [prsResult, issuesResult, worktreesResult] = await Promise.allSettled([
              container.execFn('gh', [
                'pr', 'list',
                '--repo', `${org}/${name}`,
                '--state', 'open',
                '--json', 'number,title,headRefName,author,assignees,createdAt,updatedAt',
                '--limit', '50',
              ], { timeout: 15_000 }),
              container.execFn('gh', [
                'issue', 'list',
                '--repo', `${org}/${name}`,
                '--assignee', '@me',
                '--state', 'open',
                '--json', 'number,title,author,createdAt,updatedAt',
                '--limit', '50',
              ], { timeout: 15_000 }),
              (async () => {
                const exists = await container.hostFs.exists(repoPath);
                if (!exists) return [];
                return container.listWorktrees.execute(repoPath);
              })(),
            ]);

            // Process PRs
            if (prsResult.status === 'fulfilled') {
              try {
                const rawPRs = JSON.parse(prsResult.value.stdout) as {
                  number: number; title: string; headRefName: string;
                  author: { login: string }; assignees: { login: string }[];
                  createdAt: string; updatedAt: string;
                }[];

                for (const pr of rawPRs) {
                  const mapped: DashboardPullRequest = {
                    number: pr.number,
                    title: pr.title,
                    headRefName: pr.headRefName,
                    state: 'open',
                    author: pr.author.login,
                    assignees: pr.assignees.map((a) => a.login),
                    createdAt: pr.createdAt,
                    updatedAt: pr.updatedAt,
                    org,
                    name,
                  };

                  if (pr.author.login === githubUser) {
                    myPullRequests.push(mapped);
                  } else if (pr.assignees.some((a) => a.login === githubUser)) {
                    reviewRequests.push(mapped);
                  }
                }
              } catch {
                container.logger.warn('Failed to parse PRs for dashboard', { org, name });
              }
            }

            // Process issues
            if (issuesResult.status === 'fulfilled') {
              try {
                const rawIssues = JSON.parse(issuesResult.value.stdout) as {
                  number: number; title: string;
                  author: { login: string };
                  createdAt: string; updatedAt: string;
                }[];

                for (const issue of rawIssues) {
                  const ref = `${org}/${name}#${issue.number}`;
                  assignedIssues.push({
                    number: issue.number,
                    title: issue.title,
                    author: issue.author.login,
                    createdAt: issue.createdAt,
                    updatedAt: issue.updatedAt,
                    org,
                    name,
                    hasLocalTicket: localIssueMap.has(ref),
                    linkedTicketId: localIssueMap.get(ref),
                  });
                }
              } catch {
                container.logger.warn('Failed to parse issues for dashboard', { org, name });
              }
            }

            // Process worktrees
            if (worktreesResult.status === 'fulfilled') {
              for (const wt of worktreesResult.value) {
                if (!wt.isBare && !wt.isMain) {
                  activeWorktrees.push({ ...wt, org, name });
                }
              }
            }
          }),
        );

        // ── PR ticket backfill ──────────────────────────────────────────────
        // Find-or-create dedicated boards for PR backfill
        const allBoards = await container.ticketStore.getAllBoards();
        const findOrCreateBoard = async (boardName: string, emoji: string): Promise<string> => {
          const existing = allBoards.find((b) => b.name === boardName);
          if (existing) return existing.id;
          const board = BoardEntity.create({ id: randomUUID(), name: boardName, emoji });
          await container.ticketStore.saveBoard(board);
          allBoards.push(board); // keep in sync for subsequent lookups
          return board.id;
        };

        // Eagerly resolve boards only for roles that have unlinked PRs
        const hasUnlinkedAuthorPR = myPullRequests.some((pr) => {
          const prRef = `${pr.org}/${pr.name}#${pr.number}`;
          const wtRef = `${pr.org}/${pr.name}:${pr.headRefName}`;
          return !localPRMap.has(prRef) && !worktreeBranchMap.has(wtRef);
        });
        const hasUnlinkedReviewPR = reviewRequests.some((pr) => {
          const prRef = `${pr.org}/${pr.name}#${pr.number}`;
          const wtRef = `${pr.org}/${pr.name}:${pr.headRefName}`;
          return !localPRMap.has(prRef) && !worktreeBranchMap.has(wtRef);
        });

        const [prBackfillBoardId, toReviewBoardId] = await Promise.all([
          hasUnlinkedAuthorPR ? findOrCreateBoard(PR_BACKFILL_BOARD_NAME, '🔀') : Promise.resolve(undefined),
          hasUnlinkedReviewPR ? findOrCreateBoard(TO_REVIEW_BOARD_NAME, '👀') : Promise.resolve(undefined),
        ]);

        const backfillPR = async (pr: DashboardPullRequest, role: 'author' | 'reviewer') => {
          const prRef = `${pr.org}/${pr.name}#${pr.number}`;
          const wtRef = `${pr.org}/${pr.name}:${pr.headRefName}`;

          // Already linked?
          const existingId = localPRMap.get(prRef) ?? worktreeBranchMap.get(wtRef);
          if (existingId) {
            pr.linkedTicketId = existingId;
            return;
          }

          const boardId = role === 'reviewer' ? toReviewBoardId : prBackfillBoardId;
          if (!boardId) return;

          try {
            const ticket = await container.backfillPRTicket.execute({
              org: pr.org,
              name: pr.name,
              prNumber: pr.number,
              prTitle: pr.title,
              headRefName: pr.headRefName,
              prUrl: `https://github.com/${pr.org}/${pr.name}/pull/${pr.number}`,
              boardId,
              role,
            });
            pr.linkedTicketId = ticket.id;
            // Update maps so duplicates within the same request are avoided
            localPRMap.set(prRef, ticket.id);
            worktreeBranchMap.set(wtRef, ticket.id);
          } catch (err) {
            container.logger.warn('PR ticket backfill failed', { prRef, error: String(err) });
          }
        };

        await Promise.all([
          ...myPullRequests.map((pr) => backfillPR(pr, 'author')),
          ...reviewRequests.map((pr) => backfillPR(pr, 'reviewer')),
        ]);

        // Re-compute activeTickets to include newly backfilled tickets
        const allTicketsAfterBackfill = await container.ticketStore.getAllTickets();
        const activeTicketsFinal = allTicketsAfterBackfill
          .filter((t) => t.status === 'todo' || t.status === 'doing' || t.status === 'reviewing')
          .map((t) => t.toDTO());

        const data: DashboardData = {
          activeTickets: activeTicketsFinal,
          myPullRequests,
          reviewRequests,
          assignedIssues,
          activeWorktrees,
          githubUser,
        };

        return data;
      } catch (err) {
        container.logger.error('Dashboard aggregation failed', { error: String(err) });
        return reply.code(500).send({ error: 'Failed to load dashboard data' });
      }
    });
  };
}
