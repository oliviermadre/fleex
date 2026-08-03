import { randomUUID } from 'node:crypto';

import { TicketActivityEntity } from '../../domain/entities/ticket-activity.entity.js';
import { TicketEntity } from '../../domain/entities/ticket.entity.js';

import type { LoggerPort } from '../ports/logger.port.js';
import type { TicketStorePort } from '../ports/ticket-store.port.js';

interface BackfillPRTicketParams {
  org: string;
  name: string;
  prNumber: number;
  prTitle: string;
  headRefName: string;
  prUrl: string;
  boardId: string;
  role: 'author' | 'reviewer';
}

export class BackfillPRTicketUseCase {
  constructor(
    private readonly ticketStore: TicketStorePort,
    private readonly logger: LoggerPort,
  ) {}

  async execute(params: BackfillPRTicketParams): Promise<TicketEntity> {
    const { org, name, prNumber, prTitle, headRefName, prUrl, boardId, role } = params;

    const ticketId = randomUUID();

    const title = prTitle;

    const status = role === 'reviewer' ? 'reviewing' : 'doing';

    const ticket = TicketEntity.create({
      id: ticketId,
      boardId,
      displayId: 0, // assigned by createTicket() below
      title,
      status,
    });

    // Link to the GitHub PR
    ticket.addLink('github_pr', `${org}/${name}#${prNumber}`, `#${prNumber}`, prUrl, randomUUID());

    // Link to worktree (branch)
    ticket.addLink('worktree', `${org}/${name}:${headRefName}`, headRefName, null, randomUUID());

    // Link to repository
    ticket.addLink('repository', `${org}/${name}`, `${org}/${name}`, null, randomUUID());

    await this.ticketStore.createTicket(ticket);
    await this.ticketStore.saveActivity(
      TicketActivityEntity.create({
        id: randomUUID(),
        ticketId,
        action: 'created',
        changes: { source: { from: null, to: `pr-backfill:${org}/${name}#${prNumber}` } },
        source: 'web',
      }),
    );

    this.logger.info('PR backfilled as ticket', { org, name, prNumber, ticketId, role });

    return ticket;
  }
}
