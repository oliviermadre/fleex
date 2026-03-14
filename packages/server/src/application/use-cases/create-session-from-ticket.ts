import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { TicketNotFoundError } from '../../domain/errors.js';
import { TicketActivityEntity } from '../../domain/entities/ticket-activity.entity.js';
import { buildTicketBranchName, buildWorktreeDirName } from '../../domain/services/branch-utils.js';
import type { Workspace, WorkspaceRepo, TicketLink } from '@fleex/shared';
import type { RepoPathResolver } from '../../domain/services/repo-path-resolver.js';
import type { WorkspaceStorePort } from '../ports/workspace-store.port.js';
import type { TicketStorePort } from '../ports/ticket-store.port.js';
import type { LoggerPort } from '../ports/logger.port.js';
import type { CreateSessionUseCase } from './create-session.js';
import type { CreateWorktreeUseCase } from './create-worktree.js';
import type { ConfigPort } from '../ports/config.port.js';
import type { GitPort } from '../ports/git.port.js';
import type { HostFs } from '../../infrastructure/host/types.js';

export class CreateSessionFromTicketUseCase {
  constructor(
    private readonly ticketStore: TicketStorePort,
    private readonly createSession: CreateSessionUseCase,
    private readonly createWorktree: CreateWorktreeUseCase,
    private readonly git: GitPort,
    private readonly config: ConfigPort,
    private readonly logger: LoggerPort,
    private readonly repoPathResolver?: RepoPathResolver,
    private readonly workspaceStore?: WorkspaceStorePort,
    private readonly hostFs?: HostFs,
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
        ticket.removeLink(worktreeLink.id);
        ticket.addLink('worktree', resolved.wtPath, resolved.branchName, null, randomUUID());
      }
      cwd = resolved.wtPath;
    } else {
      // Collect ALL repository links from the ticket
      const repoLinks = ticket.links.filter((l) => l.type === 'repository');
      const repos: Array<{ org: string; name: string }> = [];

      for (const repoLink of repoLinks) {
        if (repoLink.ref) {
          const slashIdx = repoLink.ref.indexOf('/');
          if (slashIdx > 0) {
            repos.push({
              org: repoLink.ref.substring(0, slashIdx),
              name: repoLink.ref.substring(slashIdx + 1),
            });
          }
        }
      }

      // Fall back to board's repository config if no repo links
      if (repos.length === 0) {
        const board = await this.ticketStore.getBoardById(ticket.boardId);
        if (board?.repositoryOrg && board.repositoryName) {
          repos.push({ org: board.repositoryOrg, name: board.repositoryName });
        }
      }

      // Create worktrees for all repos
      if (repos.length > 0) {
        const branchName = buildTicketBranchName(ticket.title, ticket.id);
        const workspaceRepos: WorkspaceRepo[] = [];
        let firstWtPath: string | null = null;

        for (const { org, name } of repos) {
          try {
            const wtResult = await this.createRepoWorktree(ticketId, org, name, branchName);
            if (!firstWtPath) firstWtPath = wtResult.wtPath;
            workspaceRepos.push({
              org,
              name,
              branch: branchName,
              bare: wtResult.mode === 'bare',
            });
          } catch (err) {
            this.logger.warn('Failed to auto-create worktree for ticket', {
              ticketId, org, name, error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        if (firstWtPath) {
          cwd = firstWtPath;
          ticket.addLink('worktree', firstWtPath, branchName, null, randomUUID());
        }

        // Persist workspace if multi-repo
        if (workspaceRepos.length > 0 && this.workspaceStore) {
          const workspace: Workspace = {
            ticketId,
            repos: workspaceRepos,
            createdAt: new Date().toISOString(),
          };
          await this.workspaceStore.save(workspace);
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

  private async createRepoWorktree(
    ticketId: string,
    org: string,
    name: string,
    branchName: string,
  ): Promise<{ wtPath: string; mode: 'regular' | 'bare' }> {
    const basePath = this.config.get().basePath;

    // Use resolver if available
    const resolved = this.repoPathResolver
      ? await this.repoPathResolver.resolve(basePath, org, name)
      : null;

    const repoPath = resolved?.repoPath ?? join(basePath, org, name);
    const mode = resolved?.mode ?? 'regular';
    const envSourcePath = resolved?.envSourcePath;

    let wtPath: string;
    if (mode === 'bare') {
      // Bare mode: worktrees go under workspaces/{ticketId}/{org}/{name}
      wtPath = join(basePath, 'workspaces', ticketId, org, name);
      // Ensure parent dirs exist
      if (this.hostFs) {
        const parentDir = join(basePath, 'workspaces', ticketId, org);
        try { await this.hostFs.mkdir(parentDir); } catch { /* may already exist */ }
      }
    } else {
      // Regular mode: sibling directory
      wtPath = join(repoPath, '..', buildWorktreeDirName(name, branchName));
    }

    await this.createWorktree.execute(repoPath, wtPath, {
      branch: branchName,
      createNewBranch: true,
    }, envSourcePath);

    return { wtPath, mode };
  }

  /**
   * Resolves the actual filesystem path for a worktree link.
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
    let envSourcePath: string | undefined;

    if (ref.startsWith('/')) {
      // Absolute path format (agent / API created).
      const repoLink = links.find((l) => l.type === 'repository');
      if (repoLink?.ref?.includes('/') && !repoLink.ref.includes(':')) {
        const slashIdx = repoLink.ref.indexOf('/');
        const org = repoLink.ref.substring(0, slashIdx);
        const name = repoLink.ref.substring(slashIdx + 1);
        const resolved = this.repoPathResolver
          ? await this.repoPathResolver.resolve(this.config.get().basePath, org, name)
          : null;
        repoPath = resolved?.repoPath ?? join(this.config.get().basePath, org, name);
        envSourcePath = resolved?.envSourcePath;
      }
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
          const resolved = this.repoPathResolver
            ? await this.repoPathResolver.resolve(this.config.get().basePath, org, name)
            : null;
          repoPath = resolved?.repoPath ?? join(this.config.get().basePath, org, name);
          envSourcePath = resolved?.envSourcePath;

          // Find the actual filesystem path via git worktree list
          try {
            const worktrees = await this.git.listWorktrees(repoPath);
            const match = worktrees.find((wt) => wt.branch === branchName);
            if (match) {
              wtPath = match.path;
            } else {
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
          const resolved = this.repoPathResolver
            ? await this.repoPathResolver.resolve(this.config.get().basePath, board.repositoryOrg, board.repositoryName)
            : null;
          repoPath = resolved?.repoPath ?? join(this.config.get().basePath, board.repositoryOrg, board.repositoryName);
          envSourcePath = resolved?.envSourcePath;
        }
      } catch { /* ignore */ }
    }

    // Auto-create the worktree if the resolved path doesn't exist locally
    if (!existsSync(wtPath) && repoPath) {
      this.logger.warn('Worktree path not found locally, auto-creating', { ticketId, wtPath, branchName });
      try {
        const actualPath = await this.createWorktree.execute(repoPath, wtPath, {
          branch: branchName,
          createNewBranch: false,
        }, envSourcePath);
        if (actualPath) {
          wtPath = actualPath;
        }
        this.logger.info('Worktree auto-created (existing branch)', { ticketId, wtPath });
      } catch {
        try {
          await this.createWorktree.execute(repoPath, wtPath, {
            branch: branchName,
            createNewBranch: true,
          }, envSourcePath);
          this.logger.info('Worktree auto-created (new branch)', { ticketId, wtPath });
        } catch (err) {
          this.logger.warn('Failed to auto-create missing worktree, falling back to repo path', {
            ticketId, wtPath, error: err instanceof Error ? err.message : String(err),
          });
          wtPath = repoPath;
        }
      }
    }

    return { wtPath, branchName };
  }
}
