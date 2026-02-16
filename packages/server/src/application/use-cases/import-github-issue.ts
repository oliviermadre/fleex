import { randomUUID } from 'node:crypto';
import { TicketEntity } from '../../domain/entities/ticket.entity.js';
import { TicketActivityEntity } from '../../domain/entities/ticket-activity.entity.js';
import type { TicketStorePort } from '../ports/ticket-store.port.js';
import type { LoggerPort } from '../ports/logger.port.js';
import type { GitHubGraphQLAdapter } from '../../infrastructure/adapters/github-graphql.adapter.js';

export class ImportGitHubIssueUseCase {
  constructor(
    private readonly ticketStore: TicketStorePort,
    private readonly githubGraphql: GitHubGraphQLAdapter,
    private readonly logger: LoggerPort,
  ) {}

  async execute(org: string, name: string, issueNumber: number, boardId: string): Promise<TicketEntity> {
    const detail = await this.githubGraphql.fetchIssueDetail(org, name, issueNumber);

    const ticketId = randomUUID();
    const ticket = TicketEntity.create({
      id: ticketId,
      boardId,
      title: detail.title,
      description: detail.body || '',
      status: 'backlog',
      tags: detail.labels ?? [],
    });

    ticket.addLink(
      'github_issue',
      `${org}/${name}#${issueNumber}`,
      `#${issueNumber}`,
      detail.url,
      randomUUID(),
    );

    await this.ticketStore.saveTicket(ticket);
    await this.ticketStore.saveActivity(TicketActivityEntity.create({
      id: randomUUID(),
      ticketId,
      action: 'created',
      changes: { source: { from: null, to: `github:${org}/${name}#${issueNumber}` } },
      source: 'web',
    }));

    this.logger.info('GitHub issue imported as ticket', { org, name, issueNumber, ticketId });

    return ticket;
  }
}
