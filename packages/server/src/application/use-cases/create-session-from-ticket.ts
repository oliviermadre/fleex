import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { TicketNotFoundError } from '../../domain/errors.js';
import { TicketActivityEntity } from '../../domain/entities/ticket-activity.entity.js';
import { buildTicketBranchName, buildWorktreeDirName } from '../../domain/services/branch-utils.js';
import type { RepoPathResolver } from '../../domain/services/repo-path-resolver.js';
import type { TicketLink } from '@fleex/shared';
import type { TicketStorePort } from '../ports/ticket-store.port.js';
import type { LoggerPort } from '../ports/logger.port.js';
import type { CreateSessionUseCase } from './create-session.js';
import type { CreateWorktreeUseCase } from './create-worktree.js';
import type { ConfigPort } from '../ports/config.port.js';
import type { GitPort } from '../ports/git.port.js';

export class CreateSessionFromTicketUseCase {
  constructor(
    private readonly ticketStore: TicketStorePort,
    private readonly createSession: CreateSessionUseCase,
    private readonly createWorktree: CreateWorktreeUseCase,
    private readonly git: GitPort,
    private readonly config: ConfigPort,
    private readonly logger: LoggerPort,
    private readonly resolver: RepoPathResolver,
  ) {}

  async execute(ticketId: string): Promise<{ sessionId: string }> {
    const ticket = await this.ticketStore.getTicketById(ticketId);
    if (!ticket) throw new TicketNotFoundError(ticketId);

    // Move ticket to doing
    const moveDiff = ticket.moveTo('doing');
    if (Object.keys(moveDiff).length > 0) {
      await this.ticketStore.saveActivity(TicketActivityEntity.create({
        id: randomUUID(),
        ticketId: ticket.id,
        action: 'moved',
        changes: moveDiff,
        source: 'web',
      }));
    }

    // Determine CWD
    let cwd = this.config.get().basePath;

    // Check if ticket has a worktree link
    const worktreeLink = ticket.links.find((l) => l.type === 'worktree');
    if (worktreeLink) {
      const resolved = await this.resolveWorktreeCwd(ticketId, ticket.boardId, ticket.links, worktreeLink);
      if (resolved.wtPath !== worktreeLink.ref) {
        // Update the link to store the canonical absolute path
        ticket.removeLink(worktreeLink.id);
        ticket.addLink('worktree', resolved.wtPath, resolved.branchName, null, randomUUID());
      }
      cwd = resolved.wtPath;
    } else {
      // Resolve repo: ticket's repository link takes priority, then board config
      let repoOrg: string | undefined;
      let repoName: string | undefined;

      const repoLink = ticket.links.find((l) => l.type === 'repository');
      if (repoLink?.ref) {
        const slashIdx = repoLink.ref.indexOf('/');
        if (slashIdx > 0) {
          repoOrg = repoLink.ref.substring(0, slashIdx);
          repoName = repoLink.ref.substring(slashIdx + 1);
        }
      }

      // Fall back to board's repository config
      if (!repoOrg || !repoName) {
        const board = await this.ticketStore.getBoardById(ticket.boardId);
        if (board?.repositoryOrg && board.repositoryName) {
          repoOrg = board.repositoryOrg;
          repoName = board.repositoryName;
        }
      }

      // Create worktree if we found a repo
      if (repoOrg && repoName) {
        const branchName = buildTicketBranchName(ticket.title, ticket.id);
        const wtPath = this.resolver.worktreeDir(repoOrg, buildWorktreeDirName(repoName, branchName));
        try {
          await this.createWorktree.execute(repoOrg, repoName, wtPath, {
            branch: branchName,
            createNewBranch: true,
          });
          cwd = wtPath;
          // Auto-link worktree
          ticket.addLink('worktree', wtPath, branchName, null, randomUUID());
        } catch (err) {
          this.logger.warn('Failed to auto-create worktree for ticket', {
            ticketId, error: err instanceof Error ? err.message : String(err),
          });
          cwd = this.resolver.barePath(repoOrg, repoName);
        }
      }
    }

    // Create Claude session
    const session = await this.createSession.execute({
      cwd,
      type: 'claude',
    });

    // Auto-link session to ticket
    ticket.addLink('session', session.id, session.tmuxName, null, randomUUID());

    await this.ticketStore.saveTicket(ticket);
    await this.ticketStore.saveActivity(TicketActivityEntity.create({
      id: randomUUID(),
      ticketId: ticket.id,
      action: 'linked',
      changes: { session: { from: null, to: session.id } },
      source: 'web',
    }));

    this.logger.info('Session created from ticket', { ticketId, sessionId: session.id });

    return { sessionId: session.id };
  }

  private async resolveWorktreeCwd(
    ticketId: string,
    boardId: string,
    links: TicketLink[],
    worktreeLink: TicketLink,
  ): Promise<{ wtPath: string; branchName: string }> {
    const ref = worktreeLink.ref;
    let wtPath: string = ref;
    let branchName: string = worktreeLink.label;
    let org: string | null = null;
    let repo: string | null = null;

    if (ref.startsWith('/')) {
      // Absolute path format (agent / API created).
      const repoLink = links.find((l) => l.type === 'repository');
      if (repoLink?.ref?.includes('/') && !repoLink.ref.includes(':')) {
        const slashIdx = repoLink.ref.indexOf('/');
        org = repoLink.ref.substring(0, slashIdx);
        repo = repoLink.ref.substring(slashIdx + 1);
      }
    } else {
      // UI format: "org/name:branch"
      const colonIdx = ref.indexOf(':');
      if (colonIdx > 0) {
        const repoKey = ref.substring(0, colonIdx);
        branchName = ref.substring(colonIdx + 1);
        const slashIdx = repoKey.indexOf('/');
        if (slashIdx > 0) {
          const parsedOrg = repoKey.substring(0, slashIdx);
          const parsedRepo = repoKey.substring(slashIdx + 1);
          org = parsedOrg;
          repo = parsedRepo;

          // Find the actual filesystem path via git worktree list
          const barePath = this.resolver.barePath(parsedOrg, parsedRepo);
          try {
            const worktrees = await this.git.listWorktrees(barePath);
            const match = worktrees.find((wt) => wt.branch === branchName);
            if (match) {
              wtPath = match.path;
            } else {
              wtPath = this.resolver.worktreeDir(parsedOrg, buildWorktreeDirName(parsedRepo, branchName));
            }
          } catch {
            wtPath = this.resolver.worktreeDir(parsedOrg, buildWorktreeDirName(parsedRepo, branchName));
          }
        }
      }
    }

    // Board fallback for repo when still unknown
    if (!org || !repo) {
      try {
        const board = await this.ticketStore.getBoardById(boardId);
        if (board?.repositoryOrg && board.repositoryName) {
          org = board.repositoryOrg;
          repo = board.repositoryName;
        }
      } catch { /* ignore */ }
    }

    // Auto-create the worktree if the resolved path doesn't exist locally
    if (!existsSync(wtPath) && org && repo) {
      this.logger.warn('Worktree path not found locally, auto-creating', { ticketId, wtPath, branchName });
      try {
        const actualPath = await this.createWorktree.execute(org, repo, wtPath, {
          branch: branchName,
          createNewBranch: false,
        });
        if (actualPath) {
          wtPath = actualPath;
        }
        this.logger.info('Worktree auto-created (existing branch)', { ticketId, wtPath });
      } catch {
        try {
          await this.createWorktree.execute(org, repo, wtPath, {
            branch: branchName,
            createNewBranch: true,
          });
          this.logger.info('Worktree auto-created (new branch)', { ticketId, wtPath });
        } catch (err) {
          this.logger.warn('Failed to auto-create missing worktree, falling back to bare path', {
            ticketId, wtPath, error: err instanceof Error ? err.message : String(err),
          });
          wtPath = this.resolver.barePath(org, repo);
        }
      }
    }

    return { wtPath, branchName };
  }
}
