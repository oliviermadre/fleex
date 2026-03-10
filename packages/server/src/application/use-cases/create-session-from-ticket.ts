import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { TicketNotFoundError } from '../../domain/errors.js';
import { TicketActivityEntity } from '../../domain/entities/ticket-activity.entity.js';
import { buildTicketBranchName, buildWorktreeDirName } from '../../domain/services/branch-utils.js';
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
      // Check board for repo scope
      const board = await this.ticketStore.getBoardById(ticket.boardId);
      if (board?.repositoryOrg && board.repositoryName) {
        const repoPath = join(this.config.get().basePath, board.repositoryOrg, board.repositoryName);
        // Try to create a worktree with a branch name based on ticket
        const branchName = buildTicketBranchName(ticket.title, ticket.id);
        try {
          const wtPath = join(repoPath, '..', buildWorktreeDirName(board.repositoryName, branchName));
          await this.createWorktree.execute(repoPath, wtPath, {
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
          cwd = repoPath;
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

  /**
   * Resolves the actual filesystem path for a worktree link.
   *
   * The worktree link `ref` can be stored in two formats:
   *  - Absolute path (e.g. `/Users/.../repo.branch`) — written by agents/API
   *  - `org/name:branch` — written by the web UI when the user selects a worktree
   *
   * After resolving the path we also check whether it exists locally and
   * auto-create the worktree when it is missing.
   */
  private async resolveWorktreeCwd(
    ticketId: string,
    boardId: string,
    links: TicketLink[],
    worktreeLink: TicketLink,
  ): Promise<{ wtPath: string; branchName: string }> {
    const ref = worktreeLink.ref;
    let wtPath: string = ref;
    let branchName: string = worktreeLink.label;
    let repoPath: string | null = null;

    if (ref.startsWith('/')) {
      // Absolute path format (agent / API created).
      // Try to derive the repo path from a repository link, then board fallback.
      const repoLink = links.find((l) => l.type === 'repository');
      if (repoLink?.ref?.includes('/') && !repoLink.ref.includes(':')) {
        const slashIdx = repoLink.ref.indexOf('/');
        const org = repoLink.ref.substring(0, slashIdx);
        const name = repoLink.ref.substring(slashIdx + 1);
        repoPath = join(this.config.get().basePath, org, name);
      }
      // Board fallback resolved later if repoPath still null
    } else {
      // UI format: "org/name:branch"
      const colonIdx = ref.indexOf(':');
      if (colonIdx > 0) {
        const repoKey = ref.substring(0, colonIdx);
        branchName = ref.substring(colonIdx + 1);
        const slashIdx = repoKey.indexOf('/');
        if (slashIdx > 0) {
          const org = repoKey.substring(0, slashIdx);
          const name = repoKey.substring(slashIdx + 1);
          repoPath = join(this.config.get().basePath, org, name);

          // Find the actual filesystem path via git worktree list
          try {
            const worktrees = await this.git.listWorktrees(repoPath);
            const match = worktrees.find((wt) => wt.branch === branchName);
            if (match) {
              wtPath = match.path;
            } else {
              // Compute the expected path the server would have chosen
              wtPath = join(repoPath, '..', buildWorktreeDirName(name, branchName));
            }
          } catch {
            wtPath = join(repoPath, '..', buildWorktreeDirName(name, branchName));
          }
        }
      }
    }

    // Board fallback for repoPath when still unknown
    if (!repoPath) {
      try {
        const board = await this.ticketStore.getBoardById(boardId);
        if (board?.repositoryOrg && board.repositoryName) {
          repoPath = join(this.config.get().basePath, board.repositoryOrg, board.repositoryName);
        }
      } catch { /* ignore */ }
    }

    // Auto-create the worktree if the resolved path doesn't exist locally
    if (!existsSync(wtPath) && repoPath) {
      this.logger.warn('Worktree path not found locally, auto-creating', { ticketId, wtPath, branchName });
      try {
        // Try checking out an existing branch first
        const actualPath = await this.createWorktree.execute(repoPath, wtPath, {
          branch: branchName,
          createNewBranch: false,
        });
        // createWorktree returns the alternative path when the branch is already
        // checked out elsewhere; fall back to it if provided.
        if (actualPath) {
          wtPath = actualPath;
        }
        this.logger.info('Worktree auto-created (existing branch)', { ticketId, wtPath });
      } catch {
        // Branch may not exist yet — create it
        try {
          await this.createWorktree.execute(repoPath, wtPath, {
            branch: branchName,
            createNewBranch: true,
          });
          this.logger.info('Worktree auto-created (new branch)', { ticketId, wtPath });
        } catch (err) {
          this.logger.warn('Failed to auto-create missing worktree, falling back to repo path', {
            ticketId, wtPath, error: err instanceof Error ? err.message : String(err),
          });
          // Last resort: use the repo itself as the working directory
          wtPath = repoPath;
        }
      }
    }

    return { wtPath, branchName };
  }
}
