import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { TicketNotFoundError } from '../../domain/errors.js';
import { TicketActivityEntity } from '../../domain/entities/ticket-activity.entity.js';
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

    // Build Claude prompt from ticket content
    let claudePrompt = ticket.title;
    if (ticket.description) {
      claudePrompt += `\n\n${ticket.description}`;
    }

    // Determine CWD
    let cwd = this.config.get().basePath;

    // Check if ticket has a worktree link
    const worktreeLink = ticket.links.find((l) => l.type === 'worktree');
    if (worktreeLink) {
      cwd = worktreeLink.ref;
    } else {
      // Check board for repo scope
      const board = await this.ticketStore.getBoardById(ticket.boardId);
      if (board?.repositoryOrg && board.repositoryName) {
        const repoPath = join(this.config.get().basePath, board.repositoryOrg, board.repositoryName);
        // Try to create a worktree with a branch name based on ticket
        const branchName = this.buildBranchName(ticket.title, ticket.id);
        try {
          const wtPath = join(repoPath, '..', `${board.repositoryName}.${branchName}`);
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
      claudePrompt,
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

  private buildBranchName(title: string, ticketId: string): string {
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    const short = ticketId.slice(0, 6);
    return `ticket/${short}-${slug}`;
  }
}
