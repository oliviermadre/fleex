import type { WorktreeDetail, TicketStatus } from '@fleex/shared';
import type { GitPort } from '../ports/git.port.js';
import type { LoggerPort } from '../ports/logger.port.js';
import type { TicketStorePort } from '../ports/ticket-store.port.js';
import type { RepoPathResolver } from '../../domain/services/repo-path-resolver.js';
import type { ListWorktreesUseCase } from './list-worktrees.js';

/**
 * Lists a repository's worktrees enriched for the cleanup view: last activity
 * (last commit date), commits ahead/behind origin, and the linked ticket with
 * its status. Each worktree is enriched independently so one failing git call
 * degrades a single row rather than the whole list.
 */
export class ListWorktreeDetailsUseCase {
  constructor(
    private readonly listWorktrees: ListWorktreesUseCase,
    private readonly git: GitPort,
    private readonly ticketStore: TicketStorePort,
    private readonly resolver: RepoPathResolver,
    private readonly logger: LoggerPort,
  ) {}

  async execute(org: string, name: string): Promise<WorktreeDetail[]> {
    const worktrees = (await this.listWorktrees.execute(org, name)).filter(
      (wt) => !wt.isBare && !wt.isMain,
    );

    // Build a map from worktree link ref → ticket. The ref is stored either as
    // an absolute path or as `org/name:branch` depending on the code path that
    // created it (mirror of tickets.routes.ts), so we index both forms.
    const tickets = await this.ticketStore.getAllTickets();
    const ticketByRef = new Map<string, { id: string; displayId: number; status: TicketStatus }>();
    for (const ticket of tickets) {
      for (const link of ticket.links) {
        if (link.type !== 'worktree') continue;
        ticketByRef.set(link.ref, { id: ticket.id, displayId: ticket.displayId, status: ticket.status });
      }
    }

    return Promise.all(
      worktrees.map(async (wt): Promise<WorktreeDetail> => {
        const [lastCommitAt, stats] = await Promise.all([
          this.git.getLastCommitDate(wt.path).catch(() => null),
          this.git.getDiffStats(wt.path, wt.branch).catch(() => ({ commitsAhead: 0, commitsBehind: 0 })),
        ]);

        const linkedTicket =
          ticketByRef.get(wt.path) ?? ticketByRef.get(`${org}/${name}:${wt.branch}`) ?? null;

        return {
          path: wt.path,
          branch: wt.branch,
          lastCommitAt,
          commitsAhead: stats.commitsAhead,
          commitsBehind: stats.commitsBehind,
          linkedTicket,
        };
      }),
    );
  }
}
