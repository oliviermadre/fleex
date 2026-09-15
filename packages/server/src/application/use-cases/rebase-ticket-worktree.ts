import type { AgentEventStorePort } from '../ports/agent-event-store.port.js';
import type { GitPort } from '../ports/git.port.js';
import type { LoggerPort } from '../ports/logger.port.js';
import type { SessionStorePort } from '../ports/session-store.port.js';
import type { CreateWorktreeUseCase } from './create-worktree.js';

export interface TicketWorktreeTarget {
  ticketId: string;
  barePath: string;
  wtPath: string;
  ticketBranch: string;
}

/**
 * Re-derive a ticket's existing worktree from another base branch. A base only
 * applies when the ticket branch is created, so changing it once the worktree
 * exists means removing the worktree and creating it again — allowed only when
 * nothing can be lost and nobody is using it.
 */
export class RebaseTicketWorktreeUseCase {
  constructor(
    private readonly git: GitPort,
    private readonly createWorktree: Pick<CreateWorktreeUseCase, 'execute'>,
    private readonly agentEventStore: Pick<AgentEventStorePort, 'getExecutionsByTicket'>,
    private readonly sessionStore: Pick<SessionStorePort, 'getAll'>,
    private readonly logger: LoggerPort,
  ) {}

  /** Why recreating the worktree would lose work or pull it from under someone; null when it is safe. */
  async findBlocker({ ticketId, barePath, wtPath, ticketBranch }: TicketWorktreeTarget): Promise<string | null> {
    const worktree = (await this.git.listWorktrees(barePath)).find((wt) => wt.path === wtPath);
    if (!worktree) return `${wtPath} is not a registered worktree`;
    if (worktree.branch !== ticketBranch) {
      return `the worktree is on '${worktree.branch || 'a detached HEAD'}', not the ticket branch, so a base branch doesn't apply to it`;
    }

    const executions = await this.agentEventStore.getExecutionsByTicket(ticketId);
    if (executions.some((e) => e.status === 'running')) return 'an agent is running on this ticket';

    const sessions = await this.sessionStore.getAll();
    const inWorktree = (cwd: string) => cwd === wtPath || cwd.startsWith(`${wtPath}/`);
    if (sessions.some((s) => s.status === 'running' && inWorktree(s.cwd))) {
      return 'a terminal session is open in the worktree';
    }

    if ((await this.git.getStatusPorcelain(wtPath)).trim() !== '') return 'the worktree has uncommitted changes';

    const ownCommits = await this.git.countOwnCommits(barePath, ticketBranch);
    if (ownCommits > 0) return `branch '${ticketBranch}' has ${ownCommits} commit(s) of its own`;

    return null;
  }

  /** Remove the worktree, then derive the ticket branch again from `baseRef` (the default branch when absent). */
  async recreate({
    org,
    name,
    barePath,
    wtPath,
    ticketBranch,
    baseRef,
  }: {
    org: string;
    name: string;
    barePath: string;
    wtPath: string;
    ticketBranch: string;
    baseRef?: string;
  }): Promise<void> {
    await this.git.removeWorktree(barePath, wtPath);
    this.logger.info('Worktree removed to change its base branch', { barePath, wtPath, branch: ticketBranch, baseRef });
    await this.createWorktree.execute(org, name, wtPath, {
      branch: ticketBranch,
      createNewBranch: true,
      ...(baseRef ? { baseBranch: baseRef } : {}),
    });
  }
}
