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

    // Build description: original body + metadata footer
    const sections: string[] = [];
    if (detail.body) {
      sections.push(detail.body);
    }

    const metaLines: string[] = [];
    metaLines.push(`- **Repository**: ${org}/${name}`);
    metaLines.push(`- **Issue**: #${issueNumber}`);
    metaLines.push(`- **State**: ${detail.state}`);
    metaLines.push(`- **Author**: @${detail.author}`);
    if (detail.assignees.length > 0) {
      metaLines.push(`- **Assignees**: ${detail.assignees.map((a: string) => `@${a}`).join(', ')}`);
    }
    if (detail.labels.length > 0) {
      metaLines.push(`- **Labels**: ${detail.labels.join(', ')}`);
    }
    if (detail.milestone) {
      metaLines.push(`- **Milestone**: ${detail.milestone}`);
    }
    metaLines.push(`- **URL**: ${detail.url}`);

    sections.push(`\n---\n\n#### GitHub Metadata\n\n${metaLines.join('\n')}`);

    const description = sections.join('\n');

    const ticketId = randomUUID();
    const ticket = TicketEntity.create({
      id: ticketId,
      boardId,
      title: detail.title,
      description,
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

    ticket.setGithubMetadata({
      state: detail.state,
      author: detail.author,
      assignees: detail.assignees,
      labels: detail.labels,
      milestone: detail.milestone,
      syncedAt: new Date().toISOString(),
    });

    ticket.addLink(
      'repository',
      `${org}/${name}`,
      `${org}/${name}`,
      null,
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
