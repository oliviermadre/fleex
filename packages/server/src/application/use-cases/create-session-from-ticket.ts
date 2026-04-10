import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TicketNotFoundError } from '../../domain/errors.js';
import { TicketActivityEntity } from '../../domain/entities/ticket-activity.entity.js';
import { buildTicketBranchName, buildTicketWorkspaceId } from '../../domain/services/branch-utils.js';
import type { RepoPathResolver } from '../../domain/services/repo-path-resolver.js';
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

    // Collect repos and branch info from ticket links
    const repoLinks = ticket.links.filter((l) => l.type === 'repository');
    const repos: { org: string; name: string }[] = [];
    for (const link of repoLinks) {
      const slashIdx = link.ref.indexOf('/');
      if (slashIdx > 0) {
        repos.push({ org: link.ref.substring(0, slashIdx), name: link.ref.substring(slashIdx + 1) });
      }
    }

    // Determine branch: use worktree link's branch if present, otherwise create a new one
    const worktreeLink = ticket.links.find((l) => l.type === 'worktree');
    const prLink = ticket.links.find((l) => l.type === 'github_pr');
    let branchName: string;
    if (worktreeLink) {
      // Extract branch from worktree link (format: "org/repo:branch" or label)
      const colonIdx = worktreeLink.ref.indexOf(':');
      branchName = colonIdx > 0 ? worktreeLink.ref.substring(colonIdx + 1) : (worktreeLink.label || worktreeLink.ref);
    } else {
      branchName = buildTicketBranchName(ticket.title, ticket.id);
    }

    // Extract PR number from github_pr link (format: "org/name#number")
    let prNumber: number | undefined;
    if (prLink) {
      const hashIdx = prLink.ref.indexOf('#');
      if (hashIdx > 0) {
        prNumber = parseInt(prLink.ref.substring(hashIdx + 1), 10) || undefined;
      }
    }

    // Create workspace and write manifest
    const workspaceId = buildTicketWorkspaceId(ticket.title, ticket.id);
    const workspacePath = this.resolver.workspacePath(workspaceId);
    mkdirSync(workspacePath, { recursive: true });
    const manifestPath = join(workspacePath, '.fleex.json');
    if (!existsSync(manifestPath)) {
      writeFileSync(manifestPath, JSON.stringify({ ticketId: ticket.id }, null, 2));
    }

    let cwd = workspacePath;

    for (const repo of repos) {
      const wtPath = this.resolver.workspaceRepoPath(workspaceId, repo.name);
      try {
        const existingPath = await this.createWorktree.execute(repo.org, repo.name, wtPath, {
          branch: branchName,
          createNewBranch: !worktreeLink,
          ...(prNumber ? { prNumber } : {}),
        });
        const actualPath = existingPath ?? wtPath;
        // Add/update worktree link with the actual path
        if (worktreeLink) {
          ticket.removeLink(worktreeLink.id);
        }
        ticket.addLink('worktree', actualPath, branchName, null, randomUUID());
      } catch (err) {
        this.logger.warn('Failed to create worktree for ticket', {
          ticketId, repo: `${repo.org}/${repo.name}`, branch: branchName,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Create shell session with ticket context for proper naming/grouping
    const firstRepoLink = ticket.links.find((l) => l.type === 'repository');
    let sessionOrg: string | undefined;
    let sessionName: string | undefined;
    if (firstRepoLink) {
      const si = firstRepoLink.ref.indexOf('/');
      if (si > 0) {
        sessionOrg = firstRepoLink.ref.substring(0, si);
        sessionName = firstRepoLink.ref.substring(si + 1);
      }
    }
    const ticketShortId = ticket.id.slice(0, 6);
    const session = await this.createSession.execute({
      cwd,
      type: 'shell',
      repositoryOrg: sessionOrg,
      repositoryName: sessionName,
      displayName: `ticket-${ticketShortId}-session`,
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

}
